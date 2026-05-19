const mongoose = require('mongoose');
const FranchiseCategory = require('../models/franchise_category');
const Franchise = require('../models/franchise');
const FranchiseService = require('../models/franchise_service');
const Category = require('../models/category');
const Service = require('../models/service');
const User = require('../models/user');
const { applyPagination } = require('../utils/pagination');
const {
    normalizeStoredCategoriesList,
    normalizeStoredServicesList,
    parseObjectIdArray,
    parseObjectIdArrayOrdered,
    coerceLegacyCategoryMappingArrays,
    validateCategoryActiveInactivePartition,
    validateCategoriesOrderPermutation,
    filterRecordsByFranchiseMappingToggle,
} = require('../utils/franchise_catalog_lists');
const { cascadeInactiveCategoriesToFranchiseServices } = require('../utils/global_catalog_cascade');
const { loadFranchiseCallerScope } = require('../utils/franchise_user_scope');

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const USER_TYPE_ADMIN = 1;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

const parseObjectId = (raw, fieldName) => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const value = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!value || !/^[a-fA-F0-9]{24}$/.test(value)) {
        return { ok: false, message: `${fieldName} must be a valid MongoDB ObjectId.` };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(value) };
};

const parseCategoriesListInput = (raw, fieldName) => {
    if (!Array.isArray(raw)) return { ok: false, message: `${fieldName} must be an array.` };
    const entries = [];
    const seen = new Set();
    for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        const isObjectShape =
            item !== null &&
            typeof item === 'object' &&
            !(item instanceof mongoose.Types.ObjectId) &&
            item.category_id !== undefined &&
            item.category_id !== null;

        if (isObjectShape) {
            const p = parseObjectId(item.category_id, `${fieldName}[${i}].category_id`);
            if (!p.ok) return p;
            const key = p.oid.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ category_id: p.oid, is_active: Boolean(item.is_active) });
        } else {
            const p = parseObjectId(item, `${fieldName}[${i}]`);
            if (!p.ok) return p;
            const key = p.oid.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ category_id: p.oid, is_active: true });
        }
    }
    return { ok: true, entries };
};

const parseOptionalQueryBool = (raw, fieldName) => {
    if (raw === undefined || raw === null) return { ok: true, present: false };
    const s = String(raw).trim().toLowerCase();
    if (s === '') return { ok: true, present: false };
    if (s === 'true' || s === '1') return { ok: true, present: true, value: true };
    if (s === 'false' || s === '0') return { ok: true, present: true, value: false };
    return { ok: false, message: `${fieldName} must be true or false.` };
};

const categoryEntryMatchesCatalogFilters = (entry, isActiveFilter, isRequestFilter) => {
    if (isActiveFilter === undefined && isRequestFilter === undefined) return true;
    const cid = entry && entry.category_id;
    const doc =
        cid && typeof cid === 'object' && !(cid instanceof mongoose.Types.ObjectId) ? cid : null;
    if (!doc) return false;
    if (isActiveFilter !== undefined && Boolean(doc.is_active) !== isActiveFilter) return false;
    if (isRequestFilter !== undefined && Boolean(doc.is_request) !== isRequestFilter) return false;
    return true;
};

const categoryIdFromMappingEntry = (entry) => {
    const cid = entry && entry.category_id;
    if (!cid) return null;
    if (cid instanceof mongoose.Types.ObjectId) return cid.toString();
    if (typeof cid === 'object' && cid._id) return cid._id.toString();
    return String(cid);
};

const applyCategoryCatalogFiltersToRecords = (records, isActiveFilter, isRequestFilter) => {
    if (isActiveFilter === undefined && isRequestFilter === undefined) return records;
    return records.map((row) => {
        const plain = row && typeof row.toObject === 'function' ? row.toObject() : { ...row };
        const list = Array.isArray(plain.categories_list) ? plain.categories_list : [];
        plain.categories_list = list.filter((e) =>
            categoryEntryMatchesCatalogFilters(e, isActiveFilter, isRequestFilter)
        );
        const allowedIds = new Set(
            plain.categories_list.map((e) => categoryIdFromMappingEntry(e)).filter(Boolean)
        );
        const pruneIdArray = (arr) =>
            Array.isArray(arr) ? arr.filter((id) => allowedIds.has(id.toString())) : arr;
        plain.active_categories = pruneIdArray(plain.active_categories);
        plain.inactive_categories = pruneIdArray(plain.inactive_categories);
        plain.categories_order = pruneIdArray(plain.categories_order);
        return plain;
    });
};

const hasFranchiseIdQueryParam = (query) => {
    const raw = query?.franchise_id;
    return raw !== undefined && raw !== null && String(raw).trim() !== '';
};

/** Hide pending requests in franchise-scoped all_* unless is_request is explicit. */
const resolveEffectiveIsRequestFilter = (query, listFlags) => {
    if (listFlags.isRequestFilter !== undefined) return listFlags.isRequestFilter;
    if (hasFranchiseIdQueryParam(query)) return false;
    return undefined;
};

/**
 * List/getById query: is_active = franchise mapping on/off (omit = both).
 * is_request = optional catalog filter on Category.is_request (pending vs approved).
 */
const resolveFranchiseMappingListQuery = (query) => {
    const m = parseOptionalQueryBool(query.is_active, 'is_active');
    if (!m.ok) return { ok: false, message: m.message };
    const r = parseOptionalQueryBool(query.is_request, 'is_request');
    if (!r.ok) return { ok: false, message: r.message };
    return {
        ok: true,
        mappingActiveFilter: m.present ? m.value : undefined,
        isRequestFilter: r.present ? r.value : undefined,
    };
};

const listPopulateFields = [
    { path: 'franchise_id', select: 'name admin_name is_active' },
    {
        path: 'categories_list',
        populate: {
            path: 'category_id',
            select: 'name desc image_url is_active is_request category_id',
        },
    },
];

/** Global `services` where `service.category_id` matches the category (_id). */
const RELATED_SERVICE_FIELDS =
    'name desc image_url category_id is_active is_request price helpers service_id tax commission payment_type minimum_deposit approval_status rejection_reason requested_by created_at updated_at';

const loadServicesGroupedByCategoryId = async (categoryObjectIds) => {
    const map = new Map();
    if (!categoryObjectIds || categoryObjectIds.length === 0) return map;
    const unique = [...new Set(categoryObjectIds.map((id) => (id ? id.toString() : '')))].filter(
        Boolean
    );
    if (unique.length === 0) return map;
    const oids = unique.map((s) => new mongoose.Types.ObjectId(s));
    const rows = await Service.find({
        deleted_at: null,
        category_id: { $in: oids },
    })
        .select(RELATED_SERVICE_FIELDS)
        .sort({ name: 1 })
        .lean();
    for (const s of rows) {
        const cid = s.category_id ? s.category_id.toString() : '';
        if (!cid) continue;
        if (!map.has(cid)) map.set(cid, []);
        map.get(cid).push(s);
    }
    return map;
};

/**
 * Attaches `related_services` on each populated `categories_list[].category_id` (global services for that category).
 */
const enrichFranchiseCategoryRecordsWithRelatedServices = async (records) => {
    if (!Array.isArray(records) || records.length === 0) return records;
    const catIds = [];
    for (const row of records) {
        const list = row.categories_list || [];
        for (const e of list) {
            const cid = e.category_id;
            if (!cid) continue;
            if (cid instanceof mongoose.Types.ObjectId) {
                catIds.push(cid);
            } else if (typeof cid === 'object' && cid._id) {
                catIds.push(cid._id);
            }
        }
    }
    const svcMap = await loadServicesGroupedByCategoryId(catIds);
    return records.map((row) => {
        const plain = row && typeof row.toObject === 'function' ? row.toObject() : { ...row };
        const list = Array.isArray(plain.categories_list) ? plain.categories_list : [];
        plain.categories_list = list.map((e) => {
            const cid = e.category_id;
            if (!cid) return e;
            let idStr;
            if (cid instanceof mongoose.Types.ObjectId) {
                idStr = cid.toString();
                const svcs = svcMap.get(idStr) || [];
                return { ...e, related_services: svcs };
            }
            if (typeof cid === 'object' && cid._id) {
                idStr = cid._id.toString();
                const svcs = svcMap.get(idStr) || [];
                return {
                    ...e,
                    category_id: {
                        ...cid,
                        related_services: svcs,
                    },
                };
            }
            return e;
        });
        return plain;
    });
};

/** When no FranchiseCategory row exists, mirror Franchise.categories as active mappings. */
const buildSyntheticFranchiseCategoryFromFranchiseDoc = async (franchiseOid) => {
    const fr = await Franchise.findOne({ _id: franchiseOid, deleted_at: null }).select('categories').lean();
    if (!fr || !Array.isArray(fr.categories) || fr.categories.length === 0) return null;
    const row = {
        _id: new mongoose.Types.ObjectId(),
        franchise_id: franchiseOid,
        categories_list: fr.categories.map((category_id) => ({ category_id, is_active: true })),
        active_categories: [...fr.categories],
        inactive_categories: [],
        categories_order: [...fr.categories],
        order_number: 0,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        synthetic_from_franchise: true,
    };
    const populated = await FranchiseCategory.populate([row], listPopulateFields);
    return populated[0];
};

/**
 * Every global category (non-deleted), each with franchise_active derived from the latest
 * franchise_category mapping for this franchise (active_categories after coerce).
 */
const buildAllCategoriesWithFranchiseMappingStatus = async (franchiseOid) => {
    const row = await FranchiseCategory.findOne({
        franchise_id: franchiseOid,
        deleted_at: null,
    })
        .sort({ created_at: -1 })
        .lean();

    let plainForCoerce = row;
    if (!row) {
        const synthetic = await buildSyntheticFranchiseCategoryFromFranchiseDoc(franchiseOid);
        if (synthetic) {
            plainForCoerce =
                typeof synthetic.toObject === 'function' ? synthetic.toObject() : { ...synthetic };
        }
    }

    const activeSet = new Set();
    if (plainForCoerce) {
        const coerced = coerceLegacyCategoryMappingArrays(plainForCoerce);
        (coerced.active_categories || []).forEach((id) => activeSet.add(id.toString()));
    }

    const allCats = await Category.find({ deleted_at: null }).lean();
    const svcMap = await loadServicesGroupedByCategoryId(allCats.map((c) => c._id));
    return allCats.map((cat) => ({
        ...cat,
        franchise_active: activeSet.has(cat._id.toString()),
        related_services: svcMap.get(cat._id.toString()) || [],
    }));
};

const matchesSearchInCategoryName = (cat, qLower) => {
    const n = cat.name != null ? String(cat.name).toLowerCase() : '';
    return n.includes(qLower);
};

const matchesSearchInRelatedServices = (cat, qLower) => {
    const svcs = cat.related_services || [];
    return svcs.some((s) => {
        const n = s.name != null ? String(s.name).toLowerCase() : '';
        return n.includes(qLower);
    });
};

/**
 * Prefer categories whose name matches `search`; if none match, include categories where any
 * related global service name matches (substring, case-insensitive).
 */
const filterAllCategoriesBySearch = (rows, searchRaw) => {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const trimmed =
        searchRaw !== undefined && searchRaw !== null ? String(searchRaw).trim() : '';
    if (!trimmed) return rows;
    const qLower = trimmed.toLowerCase();

    const nameHits = rows.filter((cat) => matchesSearchInCategoryName(cat, qLower));
    if (nameHits.length > 0) return nameHits;

    return rows.filter((cat) => matchesSearchInRelatedServices(cat, qLower));
};

const parseFranchiseCategoryCatalogSort = (query) => {
    const sortByRaw = query.sort_by;
    const sortOrderRaw = query.sort_order ?? query.order;

    let sortBy = 'name';
    if (sortByRaw !== undefined && sortByRaw !== null && String(sortByRaw).trim() !== '') {
        const s = String(sortByRaw).trim().toLowerCase();
        if (s !== 'name' && s !== 'id' && s !== '_id') {
            return { ok: false, message: 'sort_by must be name or id.' };
        }
        sortBy = s === '_id' ? 'id' : s;
    }

    let sortOrder = 1;
    if (sortOrderRaw !== undefined && sortOrderRaw !== null && String(sortOrderRaw).trim() !== '') {
        const o = String(sortOrderRaw).trim().toLowerCase();
        if (o !== 'asc' && o !== 'desc') {
            return { ok: false, message: 'sort_order must be asc or desc.' };
        }
        sortOrder = o === 'desc' ? -1 : 1;
    }

    return { ok: true, sortBy, sortOrder };
};

const sortAllCategoriesRows = (rows, sortBy, sortOrder) => {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const mult = sortOrder;
    const copy = [...rows];
    copy.sort((a, b) => {
        if (sortBy === 'id') {
            const sa = a._id.toString();
            const sb = b._id.toString();
            return mult * sa.localeCompare(sb);
        }
        const na = (a.name != null ? String(a.name) : '').toLowerCase();
        const nb = (b.name != null ? String(b.name) : '').toLowerCase();
        return mult * na.localeCompare(nb);
    });
    return copy;
};

const loadUserFranchiseAuth = async (userId) => {
    const scope = await loadFranchiseCallerScope(userId);
    if (!scope) return null;
    return {
        user: scope.user,
        isSuper: scope.isSuper,
        isFranchiseAdmin: scope.isFranchiseAdmin,
        isEmployee: scope.isEmployee,
        franchise_id: scope.franchiseOid,
    };
};

const ensureFranchise = async (franchiseOid) => {
    const franchise = await Franchise.findOne({ _id: franchiseOid, deleted_at: null }).select('admin_id');
    return franchise;
};

const ensureCategories = async (categoryIds) => {
    if (!categoryIds || categoryIds.length === 0) return true;
    const count = await Category.countDocuments({
        _id: { $in: categoryIds },
        deleted_at: null,
    });
    return count === categoryIds.length;
};

const list = async (query, userId) => {
    try {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const filter = { deleted_at: null };

        if (userId) {
            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');
            if (auth.isFranchiseAdmin || auth.isEmployee) {
                if (!auth.franchise_id) return fail(403, 'Access denied.');
                if (query.franchise_id) {
                    const parsed = parseObjectId(query.franchise_id, 'franchise_id');
                    if (!parsed.ok) return fail(400, parsed.message);
                    if (String(parsed.oid) !== String(auth.franchise_id)) {
                        return fail(403, 'Access denied.');
                    }
                }
                filter.franchise_id = auth.franchise_id;
            } else if (auth.isSuper) {
                if (query.franchise_id) {
                    const parsed = parseObjectId(query.franchise_id, 'franchise_id');
                    if (!parsed.ok) return fail(400, parsed.message);
                    filter.franchise_id = parsed.oid;
                }
            } else {
                return fail(403, 'Access denied.');
            }
        } else if (query.franchise_id) {
            const parsed = parseObjectId(query.franchise_id, 'franchise_id');
            if (!parsed.ok) return fail(400, parsed.message);
            filter.franchise_id = parsed.oid;
        }

        const listFlags = resolveFranchiseMappingListQuery(query);
        if (!listFlags.ok) return fail(400, listFlags.message);
        const isRequestFilter = resolveEffectiveIsRequestFilter(query, listFlags);

        let { data, totalCount, totalPages, currentPage } = await applyPagination(
            FranchiseCategory,
            filter,
            page,
            limit,
            { created_at: -1 },
            {},
            listPopulateFields
        );

        if (
            filter.franchise_id &&
            page === 1 &&
            data.length === 0 &&
            totalCount === 0
        ) {
            const synthetic = await buildSyntheticFranchiseCategoryFromFranchiseDoc(filter.franchise_id);
            if (synthetic) {
                data = [synthetic];
                totalCount = 1;
                totalPages = 1;
            }
        }

        let records = filterRecordsByFranchiseMappingToggle(
            applyCategoryCatalogFiltersToRecords(
                data,
                undefined,
                isRequestFilter
            ).map((row) => coerceLegacyCategoryMappingArrays(row)),
            listFlags.mappingActiveFilter,
            'categories_list',
            'active_categories',
            'inactive_categories',
            'category_id'
        );

        records = await enrichFranchiseCategoryRecordsWithRelatedServices(records);

        let all_categories;
        if (filter.franchise_id) {
            const sortOpts = parseFranchiseCategoryCatalogSort(query);
            if (!sortOpts.ok) return fail(400, sortOpts.message);

            all_categories = await buildAllCategoriesWithFranchiseMappingStatus(filter.franchise_id);
            if (isRequestFilter !== undefined) {
                all_categories = all_categories.filter(
                    (cat) => Boolean(cat.is_request) === isRequestFilter
                );
            }
            const searchTerm = query.search ?? query.q;
            all_categories = filterAllCategoriesBySearch(all_categories, searchTerm);
            all_categories = sortAllCategoriesRows(
                all_categories,
                sortOpts.sortBy,
                sortOpts.sortOrder
            );
        }

        return ok(200, {
            message: 'Franchise category list fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage,
            records,
            ...(all_categories !== undefined && { all_categories }),
        });
    } catch (error) {
        console.error('franchiseCategory.list', error.message);
        return fail(500, 'Internal server error.');
    }
};

const create = async (body) => {
    try {
        const parsedFranchise = parseObjectId(body.franchise_id, 'franchise_id');
        if (!parsedFranchise.ok) return fail(400, parsedFranchise.message);

        const parsedCategories = parseCategoriesListInput(body.categories_list || [], 'categories_list');
        if (!parsedCategories.ok) return fail(400, parsedCategories.message);

        const franchise = await ensureFranchise(parsedFranchise.oid);
        if (!franchise) return fail(404, 'Franchise not found.');

        const catIds = parsedCategories.entries.map((e) => e.category_id);
        const validCategories = await ensureCategories(catIds);
        if (!validCategories) return fail(400, 'One or more category IDs are invalid or deleted.');

        const activeCats = parsedCategories.entries
            .filter((e) => e.is_active)
            .map((e) => e.category_id);
        const inactiveCats = parsedCategories.entries
            .filter((e) => !e.is_active)
            .map((e) => e.category_id);

        const categoriesOrderIds = parsedCategories.entries.map((e) => e.category_id);

        const doc = new FranchiseCategory({
            franchise_id: parsedFranchise.oid,
            categories_list: parsedCategories.entries,
            active_categories: activeCats,
            inactive_categories: inactiveCats,
            categories_order: categoriesOrderIds,
            order_number:
                body.order_number !== undefined && body.order_number !== null
                    ? Number(body.order_number)
                    : 0,
        });

        const saved = await doc.save();
        return ok(200, {
            message: 'Franchise category created successfully.',
            record: coerceLegacyCategoryMappingArrays(saved),
        });
    } catch (error) {
        console.error('franchiseCategory.create', error.message);
        return fail(500, 'Internal server error.');
    }
};

const getById = async (id, userId, query = {}) => {
    try {
        const parsed = parseObjectId(id, 'id');
        if (!parsed.ok) return fail(400, parsed.message);
        const record = await FranchiseCategory.findOne({ _id: parsed.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');

        if (userId) {
            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');
            if (auth.isFranchiseAdmin || auth.isEmployee) {
                if (!auth.franchise_id || String(record.franchise_id) !== String(auth.franchise_id)) {
                    return fail(403, 'Access denied.');
                }
            } else if (!auth.isSuper) {
                return fail(403, 'Access denied.');
            }
        }

        const listFlags = resolveFranchiseMappingListQuery(query);
        if (!listFlags.ok) return fail(400, listFlags.message);

        await record.populate(listPopulateFields);
        const afterCatalog = applyCategoryCatalogFiltersToRecords(
            [record],
            undefined,
            listFlags.isRequestFilter
        ).map((row) => coerceLegacyCategoryMappingArrays(row));
        let [recordOut] = filterRecordsByFranchiseMappingToggle(
            afterCatalog,
            listFlags.mappingActiveFilter,
            'categories_list',
            'active_categories',
            'inactive_categories',
            'category_id'
        );
        const [enriched] = await enrichFranchiseCategoryRecordsWithRelatedServices(
            recordOut ? [recordOut] : []
        );
        recordOut = enriched || recordOut;
        return ok(200, {
            message: 'Franchise category fetched successfully.',
            record: recordOut,
        });
    } catch (error) {
        console.error('franchiseCategory.getById', error.message);
        return fail(500, 'Internal server error.');
    }
};

const update = async (id, body, userId) => {
    try {
        const parsed = parseObjectId(id, 'id');
        if (!parsed.ok) return fail(400, parsed.message);

        const record = await FranchiseCategory.findOne({ _id: parsed.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');

        if (body.franchise_id !== undefined) {
            const parsedFranchise = parseObjectId(body.franchise_id, 'franchise_id');
            if (!parsedFranchise.ok) return fail(400, parsedFranchise.message);
            const franchise = await ensureFranchise(parsedFranchise.oid);
            if (!franchise) return fail(404, 'Franchise not found.');
            record.franchise_id = parsedFranchise.oid;
        }

        if (body.categories_list !== undefined) {
            const parsedCategories = parseCategoriesListInput(body.categories_list, 'categories_list');
            if (!parsedCategories.ok) return fail(400, parsedCategories.message);
            const catIds = parsedCategories.entries.map((e) => e.category_id);
            const validCategories = await ensureCategories(catIds);
            if (!validCategories) return fail(400, 'One or more category IDs are invalid or deleted.');

            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');

            const categoriesOrderFromEntries = parsedCategories.entries.map((e) => e.category_id);

            if (auth.isSuper) {
                record.categories_list = parsedCategories.entries;
                record.active_categories = parsedCategories.entries
                    .filter((e) => e.is_active)
                    .map((e) => e.category_id);
                record.inactive_categories = parsedCategories.entries
                    .filter((e) => !e.is_active)
                    .map((e) => e.category_id);
                record.categories_order = categoriesOrderFromEntries;
                await cascadeInactiveCategoriesToFranchiseServices(
                    record.franchise_id,
                    record.inactive_categories
                );
            } else if (auth.isEmployee) {
                return fail(403, 'Franchise employees cannot update categories list.');
            } else if (auth.isFranchiseAdmin) {
                if (String(record.franchise_id) !== String(auth.franchise_id)) {
                    return fail(403, 'Access denied.');
                }
                record.categories_list = parsedCategories.entries;
                record.active_categories = parsedCategories.entries
                    .filter((e) => e.is_active)
                    .map((e) => e.category_id);
                record.inactive_categories = parsedCategories.entries
                    .filter((e) => !e.is_active)
                    .map((e) => e.category_id);
                record.categories_order = categoriesOrderFromEntries;
                await cascadeInactiveCategoriesToFranchiseServices(
                    record.franchise_id,
                    record.inactive_categories
                );
            } else {
                return fail(403, 'Access denied.');
            }
        }

        const isStatusEditRequest =
            body.active_categories !== undefined || body.inactive_categories !== undefined;

        if (isStatusEditRequest) {
            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');

            const franchise = await Franchise.findOne({
                _id: record.franchise_id,
                deleted_at: null,
            })
                .select('admin_id')
                .lean();
            if (!franchise) return fail(404, 'Franchise not found.');

            const canEditStatus = auth.isSuper || String(franchise.admin_id) === String(userId);
            if (!canEditStatus) {
                return fail(
                    403,
                    'Only this franchise admin or a super admin can update active/inactive category lists.'
                );
            }

            const normList = normalizeStoredCategoriesList(record.categories_list);
            const catalogStr = new Set(normList.map((e) => e.category_id.toString()));

            let activeIds;
            let inactiveIds;
            if (body.active_categories !== undefined && body.inactive_categories !== undefined) {
                const pa = parseObjectIdArray(body.active_categories, 'active_categories');
                if (!pa.ok) return fail(400, pa.message);
                const pi = parseObjectIdArray(body.inactive_categories, 'inactive_categories');
                if (!pi.ok) return fail(400, pi.message);
                activeIds = pa.oids;
                inactiveIds = pi.oids;
            } else if (body.active_categories !== undefined) {
                const pa = parseObjectIdArray(body.active_categories, 'active_categories');
                if (!pa.ok) return fail(400, pa.message);
                activeIds = pa.oids;
                const activeStr = new Set(activeIds.map((a) => a.toString()));
                inactiveIds = normList
                    .filter((e) => !activeStr.has(e.category_id.toString()))
                    .map((e) => e.category_id);
            } else {
                const pi = parseObjectIdArray(body.inactive_categories, 'inactive_categories');
                if (!pi.ok) return fail(400, pi.message);
                inactiveIds = pi.oids;
                const inactiveStr = new Set(inactiveIds.map((a) => a.toString()));
                activeIds = normList
                    .filter((e) => !inactiveStr.has(e.category_id.toString()))
                    .map((e) => e.category_id);
            }

            const partitionCheck = validateCategoryActiveInactivePartition(
                catalogStr,
                activeIds,
                inactiveIds
            );
            if (!partitionCheck.ok) return fail(400, partitionCheck.message);

            record.active_categories = activeIds;
            record.inactive_categories = inactiveIds;
            await cascadeInactiveCategoriesToFranchiseServices(record.franchise_id, inactiveIds);
        }

        if (body.categories_order !== undefined) {
            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');
            if (auth.isEmployee) {
                return fail(403, 'Franchise employees cannot update categories order.');
            }
            const canEditOrder =
                auth.isSuper ||
                (auth.isFranchiseAdmin &&
                    String(record.franchise_id) === String(auth.franchise_id));
            if (!canEditOrder) {
                return fail(403, 'Access denied.');
            }
            const normListOrder = normalizeStoredCategoriesList(record.categories_list);
            const catalogStrOrder = new Set(normListOrder.map((e) => e.category_id.toString()));
            const po = parseObjectIdArrayOrdered(body.categories_order, 'categories_order');
            if (!po.ok) return fail(400, po.message);
            const orderCheck = validateCategoriesOrderPermutation(po.oids, catalogStrOrder);
            if (!orderCheck.ok) return fail(400, orderCheck.message);
            record.categories_order = po.oids;
        }

        if (body.order_number !== undefined) {
            record.order_number = Number(body.order_number);
        }

        record.updated_at = new Date();
        const updated = await record.save();
        return ok(200, {
            message: 'Franchise category updated successfully.',
            record: coerceLegacyCategoryMappingArrays(updated),
        });
    } catch (error) {
        console.error('franchiseCategory.update', error.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    list,
    create,
    getById,
    update,
};
