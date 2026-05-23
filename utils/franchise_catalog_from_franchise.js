const mongoose = require('mongoose');
const Franchise = require('../models/franchise');
const Category = require('../models/category');
const Service = require('../models/service');
const {
    coerceLegacyCategoryMappingArrays,
    coerceLegacyServiceMappingArrays,
} = require('./franchise_catalog_lists');

/** Matches catalog_availability_resolver isGlobalCatalogRowActive — assignable global catalog only. */
const GLOBAL_ACTIVE_CATEGORY_FILTER = {
    deleted_at: null,
    is_active: true,
    is_request: { $ne: true },
};

const GLOBAL_ACTIVE_SERVICE_FILTER = {
    deleted_at: null,
    is_active: true,
    is_request: { $ne: true },
};

/** Super-admin “active services” list/count (service active; parent category may be inactive). */
const GLOBAL_ACTIVE_SERVICE_LIST_FILTER = GLOBAL_ACTIVE_SERVICE_FILTER;

const toIdStr = (id) => (id ? id.toString() : '');

/** Skip invalid franchise catalog ids instead of throwing BSONError on corrupt DB rows. */
const coerceCatalogObjectId = (raw) => {
    if (raw === undefined || raw === null) return null;
    if (raw instanceof mongoose.Types.ObjectId) return raw;
    const s = String(raw).trim();
    if (!s || !mongoose.isValidObjectId(s)) return null;
    return new mongoose.Types.ObjectId(s);
};

const loadAssignableGlobalCategoryIds = async () => {
    const rows = await Category.find(GLOBAL_ACTIVE_CATEGORY_FILTER).select('_id').lean();
    return rows.map((row) => row._id);
};

/**
 * Globally assignable services: service is globally active AND its parent category is globally active.
 * Excludes deleted/inactive globals and services under inactive/deleted categories.
 */
const loadAssignableGlobalServiceRows = async () => {
    const services = await Service.find(GLOBAL_ACTIVE_SERVICE_FILTER)
        .select('_id category_id')
        .lean();
    if (services.length === 0) return [];

    const categoryIds = [
        ...new Set(
            services
                .map((s) => (s.category_id ? s.category_id.toString() : ''))
                .filter(Boolean)
        ),
    ]
        .map((id) => coerceCatalogObjectId(id))
        .filter(Boolean);

    if (categoryIds.length === 0) return [];

    const activeCategories = await Category.find({
        _id: { $in: categoryIds },
        ...GLOBAL_ACTIVE_CATEGORY_FILTER,
    })
        .select('_id')
        .lean();
    const activeCategorySet = new Set(activeCategories.map((c) => c._id.toString()));

    return services.filter((s) => {
        const catKey = s.category_id ? s.category_id.toString() : '';
        return catKey && activeCategorySet.has(catKey);
    });
};

const countAssignableGlobalServices = async () => {
    const rows = await loadAssignableGlobalServiceRows();
    return rows.length;
};

/** All globally active services (matches GET /api/service?is_active=true totals). */
const loadGloballyActiveServiceRows = async () =>
    Service.find(GLOBAL_ACTIVE_SERVICE_LIST_FILTER).select('_id category_id').lean();

const GLOBAL_ACTIVE_SERVICE_LIST_SELECT =
    'name desc image_url category_id is_active is_request approval_status rejection_reason';

/**
 * Globally active services with category_id populated (batched $in for large catalogs).
 */
const loadGloballyActiveServicesPopulated = async (
    categorySelect = 'name desc image_url is_active is_request category_id approval_status rejection_reason'
) => {
    const globalActiveRows = await loadGloballyActiveServiceRows();
    const ids = globalActiveRows.map((r) => r._id).filter(Boolean);
    if (ids.length === 0) return [];

    const categoryPopulate = {
        path: 'category_id',
        select: categorySelect,
        match: { deleted_at: null },
    };

    const BATCH = 500;
    const out = [];
    for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const rows = await Service.find({ _id: { $in: batch } })
            .select(GLOBAL_ACTIVE_SERVICE_LIST_SELECT)
            .populate(categoryPopulate)
            .lean();
        for (const svc of rows) {
            if (svc.category_id) out.push(svc);
        }
    }
    return out;
};

const countGloballyActiveServices = async () =>
    Service.countDocuments(GLOBAL_ACTIVE_SERVICE_LIST_FILTER);

const loadGloballyActiveServiceIdSet = async () => {
    const rows = await loadGloballyActiveServiceRows();
    return new Set(rows.map((r) => toIdStr(r._id)).filter(Boolean));
};

const loadAssignableGlobalCategoryIdSet = async () => {
    const ids = await loadAssignableGlobalCategoryIds();
    return new Set(ids.map(toIdStr).filter(Boolean));
};

const loadAssignableGlobalServiceIdSet = async () => {
    const rows = await loadAssignableGlobalServiceRows();
    return new Set(rows.map((r) => toIdStr(r._id)).filter(Boolean));
};

const dedupeIdsPreserveOrder = (oids) => {
    const seen = new Set();
    const out = [];
    for (const oid of oids || []) {
        const coerced = coerceCatalogObjectId(oid);
        if (!coerced) continue;
        const s = coerced.toString();
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(coerced);
    }
    return out;
};

/** Compare two ObjectId arrays in order (after normalizing to strings). */
const catalogIdArraysEqual = (before, after) => {
    const a = dedupeIdsPreserveOrder(before || []).map(toIdStr);
    const b = dedupeIdsPreserveOrder(after || []).map(toIdStr);
    if (a.length !== b.length) return false;
    return a.every((s, i) => s === b[i]);
};

/**
 * Drop franchise catalog IDs that are no longer globally assignable (deleted / inactive / request, or bad parent for services).
 */
const pruneFranchiseCatalogIdArrays = (
    categoryIds,
    serviceIds,
    assignableCategorySet,
    assignableServiceSet
) => {
    const categories = dedupeIdsPreserveOrder(
        (categoryIds || []).filter((id) => assignableCategorySet.has(toIdStr(id)))
    );
    const services = dedupeIdsPreserveOrder(
        (serviceIds || []).filter((id) => assignableServiceSet.has(toIdStr(id)))
    );
    return { categories, services };
};

const FRANCHISE_CATALOG_SELECT =
    '_id categories services created_at updated_at name admin_name is_active admin_id';

/**
 * On read: remove stale category/service IDs from franchise doc and persist when changed.
 * Keeps getCount active_* aligned with getAll active_categories / active_services lengths.
 */
const pruneAndPersistFranchiseCatalogIds = async (franchiseOid) => {
    const franchise = await Franchise.findOne({ _id: franchiseOid, deleted_at: null });
    if (!franchise) return null;

    const [assignableCategorySet, assignableServiceSet] = await Promise.all([
        loadAssignableGlobalCategoryIdSet(),
        loadAssignableGlobalServiceIdSet(),
    ]);

    let { categories, services } = pruneFranchiseCatalogIdArrays(
        franchise.categories,
        franchise.services,
        assignableCategorySet,
        assignableServiceSet
    );

    services = await filterServiceIdsToFranchiseEnabledCategories(categories, services);

    const categoriesChanged = !catalogIdArraysEqual(franchise.categories, categories);
    const servicesChanged = !catalogIdArraysEqual(franchise.services, services);

    if (categoriesChanged || servicesChanged) {
        franchise.categories = categories;
        franchise.services = services;
        franchise.updated_at = new Date();
        try {
            await franchise.save();
        } catch (saveErr) {
            console.error('pruneAndPersistFranchiseCatalogIds save failed', saveErr);
        }
    }

    return Franchise.findOne({ _id: franchiseOid, deleted_at: null })
        .select(FRANCHISE_CATALOG_SELECT)
        .lean();
};

/** Enabled map from franchise.categories[] or franchise.services[] (membership = enabled). */
const buildEnabledMapFromFranchiseIds = (ids) => {
    const map = new Map();
    for (const id of ids || []) {
        const key = toIdStr(id);
        if (key) map.set(key, true);
    }
    return map;
};

const buildFranchiseEnabledMaps = (franchise) => {
    const categoryIds = dedupeIdsPreserveOrder(franchise?.categories || []);
    const serviceIds = dedupeIdsPreserveOrder(franchise?.services || []);
    return {
        assignedCategoryIds: categoryIds,
        assignedServiceIds: serviceIds,
        categoryEnabled: buildEnabledMapFromFranchiseIds(categoryIds),
        serviceEnabled: buildEnabledMapFromFranchiseIds(serviceIds),
    };
};

/**
 * Virtual franchise_category row for API compatibility.
 * `_id` equals franchise `_id` so update/getById target the franchise document.
 */
const buildVirtualCategoryMappingRecord = async (franchiseLean) => {
    if (!franchiseLean) return null;
    const franchiseOid = franchiseLean._id;
    const activeIds = dedupeIdsPreserveOrder(franchiseLean.categories || []);
    const activeSet = new Set(activeIds.map(toIdStr));

    // Inactive = globally active categories this franchise has not enabled (exclude deleted/inactive globals).
    const allRows = await Category.find(GLOBAL_ACTIVE_CATEGORY_FILTER).select('_id').lean();
    const inactiveIds = [];
    for (const row of allRows) {
        const key = row._id.toString();
        if (!activeSet.has(key)) inactiveIds.push(row._id);
    }
    inactiveIds.sort((a, b) => a.toString().localeCompare(b.toString()));

    const categories_list = [
        ...activeIds.map((category_id) => ({ category_id, is_active: true })),
        ...inactiveIds.map((category_id) => ({ category_id, is_active: false })),
    ];
    const categories_order = [...activeIds, ...inactiveIds];

    return coerceLegacyCategoryMappingArrays({
        _id: franchiseOid,
        franchise_id: franchiseOid,
        categories_list,
        categories_order,
        order_number: 0,
        created_at: franchiseLean.created_at ?? null,
        updated_at: franchiseLean.updated_at ?? null,
        deleted_at: null,
        from_franchise_doc: true,
    });
};

/** Virtual franchise_service row for API compatibility. */
const buildVirtualServiceMappingRecord = async (franchiseLean) => {
    if (!franchiseLean) return null;
    const franchiseOid = franchiseLean._id;
    const activeIds = await filterServiceIdsToFranchiseEnabledCategories(
        franchiseLean.categories || [],
        franchiseLean.services || []
    );
    const activeSet = new Set(activeIds.map(toIdStr));

    // Inactive = globally active services not enabled on this franchise (parent category may be inactive).
    const allRows = await loadGloballyActiveServiceRows();
    const inactiveIds = [];
    for (const row of allRows) {
        const key = row._id.toString();
        if (!activeSet.has(key)) inactiveIds.push(row._id);
    }
    inactiveIds.sort((a, b) => a.toString().localeCompare(b.toString()));

    const services_list = [
        ...activeIds.map((service_id) => ({ service_id, is_active: true })),
        ...inactiveIds.map((service_id) => ({ service_id, is_active: false })),
    ];
    const services_order = [...activeIds, ...inactiveIds];

    return coerceLegacyServiceMappingArrays({
        _id: franchiseOid,
        franchise_id: franchiseOid,
        services_list,
        services_order,
        order_number: 0,
        created_at: franchiseLean.created_at ?? null,
        updated_at: franchiseLean.updated_at ?? null,
        deleted_at: null,
        from_franchise_doc: true,
    });
};

const loadFranchiseForCatalog = async (franchiseOid) => pruneAndPersistFranchiseCatalogIds(franchiseOid);

const activeCategoryIdsFromListEntries = (entries) =>
    dedupeIdsPreserveOrder(
        (entries || []).filter((e) => e && e.is_active).map((e) => e.category_id)
    );

const activeServiceIdsFromListEntries = (entries) =>
    dedupeIdsPreserveOrder(
        (entries || []).filter((e) => e && e.is_active).map((e) => e.service_id)
    );

/**
 * Keep only services whose parent category is in franchise.categories[].
 */
const filterServiceIdsToFranchiseEnabledCategories = async (enabledCategoryIds, serviceIds) => {
    const enabledCatSet = new Set((enabledCategoryIds || []).map(toIdStr).filter(Boolean));
    const candidateIds = dedupeIdsPreserveOrder(serviceIds || []);
    if (candidateIds.length === 0) return [];
    if (enabledCatSet.size === 0) return [];

    const rows = await Service.find({
        _id: { $in: candidateIds },
        deleted_at: null,
    })
        .select('_id category_id')
        .lean();

    return dedupeIdsPreserveOrder(
        rows
            .filter((row) => {
                const catKey = row.category_id ? toIdStr(row.category_id) : '';
                return catKey && enabledCatSet.has(catKey);
            })
            .map((row) => row._id)
    );
};

const saveFranchiseCategories = async (franchiseOid, categoryIds) => {
    const franchise = await Franchise.findOne({ _id: franchiseOid, deleted_at: null });
    if (!franchise) return null;

    const assignableCategorySet = await loadAssignableGlobalCategoryIdSet();
    franchise.categories = dedupeIdsPreserveOrder(
        (categoryIds || []).filter((id) => assignableCategorySet.has(toIdStr(id)))
    );

    franchise.services = await filterServiceIdsToFranchiseEnabledCategories(
        franchise.categories,
        franchise.services || []
    );

    franchise.updated_at = new Date();
    return franchise.save();
};

const saveFranchiseServices = async (franchiseOid, serviceIds) => {
    const franchise = await Franchise.findOne({ _id: franchiseOid, deleted_at: null });
    if (!franchise) return null;

    const assignableServiceSet = await loadAssignableGlobalServiceIdSet();
    const assignableIds = dedupeIdsPreserveOrder(
        (serviceIds || []).filter((id) => assignableServiceSet.has(toIdStr(id)))
    );

    franchise.services = await filterServiceIdsToFranchiseEnabledCategories(
        franchise.categories || [],
        assignableIds
    );
    franchise.updated_at = new Date();
    return franchise.save();
};

/** Apply categories_order to franchise.categories (active ids only, unknown ids appended). */
const applyCategoryOrderToFranchiseIds = (activeIds, orderIds) => {
    const activeSet = new Set(activeIds.map(toIdStr));
    const ordered = [];
    const seen = new Set();
    for (const oid of orderIds || []) {
        const coerced = coerceCatalogObjectId(oid);
        if (!coerced) continue;
        const key = coerced.toString();
        if (!activeSet.has(key) || seen.has(key)) continue;
        seen.add(key);
        ordered.push(coerced);
    }
    for (const oid of activeIds) {
        const key = toIdStr(oid);
        if (seen.has(key)) continue;
        ordered.push(oid);
    }
    return ordered;
};

const applyServiceOrderToFranchiseIds = (activeIds, orderIds) =>
    applyCategoryOrderToFranchiseIds(activeIds, orderIds);

/** Paginate an in-memory catalog array (services/categories), not Franchise documents. */
const paginateArray = (rows, page, limit) => {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.max(1, parseInt(limit, 10) || 10);
    const totalItems = Array.isArray(rows) ? rows.length : 0;
    if (totalItems === 0) {
        return { data: [], totalItems: 0, totalPages: 0, currentPage: 1 };
    }
    const totalPages = Math.ceil(totalItems / l);
    const currentPage = Math.min(p, totalPages);
    const skip = (currentPage - 1) * l;
    return {
        data: rows.slice(skip, skip + l),
        totalItems,
        totalPages,
        currentPage,
    };
};

module.exports = {
    toIdStr,
    coerceCatalogObjectId,
    dedupeIdsPreserveOrder,
    catalogIdArraysEqual,
    buildEnabledMapFromFranchiseIds,
    buildFranchiseEnabledMaps,
    buildVirtualCategoryMappingRecord,
    buildVirtualServiceMappingRecord,
    loadFranchiseForCatalog,
    activeCategoryIdsFromListEntries,
    activeServiceIdsFromListEntries,
    filterServiceIdsToFranchiseEnabledCategories,
    saveFranchiseCategories,
    saveFranchiseServices,
    applyCategoryOrderToFranchiseIds,
    applyServiceOrderToFranchiseIds,
    GLOBAL_ACTIVE_CATEGORY_FILTER,
    GLOBAL_ACTIVE_SERVICE_FILTER,
    GLOBAL_ACTIVE_SERVICE_LIST_FILTER,
    loadAssignableGlobalCategoryIds,
    loadAssignableGlobalServiceRows,
    loadGloballyActiveServiceRows,
    loadGloballyActiveServicesPopulated,
    countAssignableGlobalServices,
    countGloballyActiveServices,
    loadGloballyActiveServiceIdSet,
    loadAssignableGlobalCategoryIdSet,
    loadAssignableGlobalServiceIdSet,
    pruneFranchiseCatalogIdArrays,
    pruneAndPersistFranchiseCatalogIds,
    paginateArray,
};
