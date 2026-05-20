const mongoose = require('mongoose');
const Franchise = require('../models/franchise');
const Category = require('../models/category');
const Service = require('../models/service');
const {
    coerceLegacyCategoryMappingArrays,
    coerceLegacyServiceMappingArrays,
} = require('./franchise_catalog_lists');

const toIdStr = (id) => (id ? id.toString() : '');

const dedupeIdsPreserveOrder = (oids) => {
    const seen = new Set();
    const out = [];
    for (const oid of oids || []) {
        if (!oid) continue;
        const s = oid.toString();
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(oid instanceof mongoose.Types.ObjectId ? oid : new mongoose.Types.ObjectId(s));
    }
    return out;
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

    const allRows = await Category.find({ deleted_at: null }).select('_id').lean();
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
    const activeIds = dedupeIdsPreserveOrder(franchiseLean.services || []);
    const activeSet = new Set(activeIds.map(toIdStr));

    const allRows = await Service.find({ deleted_at: null }).select('_id').lean();
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

const loadFranchiseForCatalog = async (franchiseOid) =>
    Franchise.findOne({ _id: franchiseOid, deleted_at: null })
        .select('_id categories services created_at updated_at name admin_name is_active admin_id')
        .lean();

const activeCategoryIdsFromListEntries = (entries) =>
    dedupeIdsPreserveOrder(
        (entries || []).filter((e) => e && e.is_active).map((e) => e.category_id)
    );

const activeServiceIdsFromListEntries = (entries) =>
    dedupeIdsPreserveOrder(
        (entries || []).filter((e) => e && e.is_active).map((e) => e.service_id)
    );

const saveFranchiseCategories = async (franchiseOid, categoryIds) => {
    const franchise = await Franchise.findOne({ _id: franchiseOid, deleted_at: null });
    if (!franchise) return null;
    franchise.categories = dedupeIdsPreserveOrder(categoryIds);
    franchise.updated_at = new Date();
    return franchise.save();
};

const saveFranchiseServices = async (franchiseOid, serviceIds) => {
    const franchise = await Franchise.findOne({ _id: franchiseOid, deleted_at: null });
    if (!franchise) return null;
    franchise.services = dedupeIdsPreserveOrder(serviceIds);
    franchise.updated_at = new Date();
    return franchise.save();
};

/** Apply categories_order to franchise.categories (active ids only, unknown ids appended). */
const applyCategoryOrderToFranchiseIds = (activeIds, orderIds) => {
    const activeSet = new Set(activeIds.map(toIdStr));
    const ordered = [];
    const seen = new Set();
    for (const oid of orderIds || []) {
        const key = toIdStr(oid);
        if (!activeSet.has(key) || seen.has(key)) continue;
        seen.add(key);
        ordered.push(oid instanceof mongoose.Types.ObjectId ? oid : new mongoose.Types.ObjectId(key));
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

module.exports = {
    toIdStr,
    dedupeIdsPreserveOrder,
    buildEnabledMapFromFranchiseIds,
    buildFranchiseEnabledMaps,
    buildVirtualCategoryMappingRecord,
    buildVirtualServiceMappingRecord,
    loadFranchiseForCatalog,
    activeCategoryIdsFromListEntries,
    activeServiceIdsFromListEntries,
    saveFranchiseCategories,
    saveFranchiseServices,
    applyCategoryOrderToFranchiseIds,
    applyServiceOrderToFranchiseIds,
};
