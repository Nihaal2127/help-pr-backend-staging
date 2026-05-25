const mongoose = require('mongoose');
const { fieldLabel } = require('../utils/field_labels');
const Franchise = require('../models/franchise');
const FranchiseService = require('../models/franchise_service');
const Service = require('../models/service');
const User = require('../models/user');
const {
    normalizeStoredServicesList,
    parseObjectIdArray,
    parseObjectIdArrayOrdered,
    coerceLegacyServiceMappingArrays,
    validateServiceActiveInactivePartition,
    validateServicesOrderPermutation,
    filterRecordsByFranchiseMappingToggle,
} = require('../utils/franchise_catalog_lists');
const {
    resolveFranchiseMappingPreferenceMaps,
    annotateCatalogRowWithAvailability,
    isGlobalCatalogRowActive,
    loadGlobalCategoryActiveMap,
    enrichFranchiseServiceMappingRecords,
} = require('../utils/catalog_availability_resolver');
const {
    loadFranchiseCallerScope,
    resolveFranchiseCatalogListScope,
} = require('../utils/franchise_user_scope');
const {
    buildVirtualServiceMappingRecord,
    loadFranchiseForCatalog,
    activeServiceIdsFromListEntries,
    saveFranchiseServices,
    filterServiceIdsToFranchiseEnabledCategories,
    applyServiceOrderToFranchiseIds,
    toIdStr,
    GLOBAL_ACTIVE_CATEGORY_FILTER,
    loadGloballyActiveServicesPopulated,
    coerceCatalogObjectId,
    paginateArray,
} = require('../utils/franchise_catalog_from_franchise');
const {
    diffRemovedIds,
    onFranchiseServicesRemoved,
} = require('./catalog_cascade_service');
const { getFranchiseUserIdsForScope } = require('../utils/franchise_catalog_dashboard_counts');

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const USER_TYPE_ADMIN = 1;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

const parseObjectId = (raw, fieldName) => {
    if (raw instanceof mongoose.Types.ObjectId) return { ok: true, oid: raw };
    const value = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!value || !/^[a-fA-F0-9]{24}$/.test(value)) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be a valid MongoDB ObjectId.` };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(value) };
};

const parseServicesListInput = (raw, fieldName) => {
    if (!Array.isArray(raw)) return { ok: false, message: `${fieldLabel(fieldName)} must be an array.` };
    const entries = [];
    const seen = new Set();
    for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        const isObjectShape =
            item !== null &&
            typeof item === 'object' &&
            !(item instanceof mongoose.Types.ObjectId) &&
            item.service_id !== undefined &&
            item.service_id !== null;

        if (isObjectShape) {
            const p = parseObjectId(item.service_id, `${fieldName}[${i}].service_id`);
            if (!p.ok) return p;
            const key = p.oid.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ service_id: p.oid, is_active: Boolean(item.is_active) });
        } else {
            const p = parseObjectId(item, `${fieldName}[${i}]`);
            if (!p.ok) return p;
            const key = p.oid.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ service_id: p.oid, is_active: true });
        }
    }
    return { ok: true, entries };
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

const parseOptionalQueryBool = (raw, fieldName) => {
    if (raw === undefined || raw === null) return { ok: true, present: false };
    const s = String(raw).trim().toLowerCase();
    if (s === '') return { ok: true, present: false };
    if (s === 'true' || s === '1') return { ok: true, present: true, value: true };
    if (s === 'false' || s === '0') return { ok: true, present: true, value: false };
    return { ok: false, message: `${fieldLabel(fieldName)} must be true or false.` };
};

const serviceEntryMatchesCatalogFilters = (entry, isActiveFilter, isRequestFilter) => {
    if (isActiveFilter === undefined && isRequestFilter === undefined) return true;
    const sid = entry && entry.service_id;
    const doc =
        sid && typeof sid === 'object' && !(sid instanceof mongoose.Types.ObjectId) ? sid : null;
    if (!doc) return false;
    if (isActiveFilter !== undefined && Boolean(doc.is_active) !== isActiveFilter) return false;
    if (isRequestFilter !== undefined && Boolean(doc.is_request) !== isRequestFilter) return false;
    return true;
};

const applyServiceCatalogFiltersToRecords = (records, isActiveFilter, isRequestFilter) => {
    if (isActiveFilter === undefined && isRequestFilter === undefined) return records;
    return records.map((row) => {
        const plain = row && typeof row.toObject === 'function' ? row.toObject() : { ...row };
        const list = Array.isArray(plain.services_list) ? plain.services_list : [];
        plain.services_list = list.filter((e) =>
            serviceEntryMatchesCatalogFilters(e, isActiveFilter, isRequestFilter)
        );
        return plain;
    });
};

/**
 * List/getById query: is_active = franchise mapping on/off (omit = both).
 * is_request = optional catalog filter on Service.is_request.
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
    return Franchise.findOne({ _id: franchiseOid, deleted_at: null }).select('admin_id');
};

const ensureServices = async (serviceIds) => {
    if (!serviceIds || serviceIds.length === 0) return true;
    const count = await Service.countDocuments({
        _id: { $in: serviceIds },
        deleted_at: null,
    });
    return count === serviceIds.length;
};

const categoryPopulateSelect =
    'name desc image_url is_active is_request category_id approval_status rejection_reason';

const listPopulateFields = [
    { path: 'franchise_id', select: 'name admin_name is_active' },
    {
        path: 'services_list',
        populate: {
            path: 'service_id',
            select:
                'name desc image_url category_id is_active is_request approval_status rejection_reason',
            populate: {
                path: 'category_id',
                select: categoryPopulateSelect,
                match: { deleted_at: null },
            },
        },
    },
];

/** Build API mapping record from franchise.services[] (record _id = franchise _id). */
const buildServiceMappingRecordFromFranchise = async (franchiseOid) => {
    const franchise = await loadFranchiseForCatalog(franchiseOid);
    if (!franchise) return null;
    const row = await buildVirtualServiceMappingRecord(franchise);
    if (!row) return null;
    const populated = await FranchiseService.populate([row], listPopulateFields);
    return populated[0];
};

/**
 * Every globally active service (same set as super-admin active services), annotated with franchise preference and effective availability.
 */
const buildAllServicesWithFranchiseMappingStatus = async (franchiseOid) => {
    const local = await resolveFranchiseMappingPreferenceMaps(franchiseOid);
    if (!local.ok) {
        throw new Error(local.message || 'Failed to load franchise service preferences.');
    }
    const franchiseServiceEnabled = local.serviceEnabled;
    const franchiseCategoryEnabled = local.categoryEnabled;

    const allSvcs = await loadGloballyActiveServicesPopulated(categoryPopulateSelect);
    if (allSvcs.length === 0) return [];

    const catIds = [
        ...new Set(
            allSvcs
                .map((s) => {
                    const c = s.category_id;
                    if (!c) return null;
                    const raw = c._id ? c._id : c;
                    const oid = coerceCatalogObjectId(raw);
                    return oid ? oid.toString() : null;
                })
                .filter(Boolean)
        ),
    ]
        .map((s) => coerceCatalogObjectId(s))
        .filter(Boolean);
    const globalCatActive = await loadGlobalCategoryActiveMap(catIds);

    return allSvcs.map((svc) => {
        const svcKey = svc._id.toString();
        const catRef = svc.category_id;
        const catKey = catRef
            ? catRef._id
                ? catRef._id.toString()
                : catRef.toString()
            : '';
        const globalServiceActive = isGlobalCatalogRowActive(svc);
        const globalCategoryActive = catKey ? globalCatActive.get(catKey) === true : false;
        const franchiseServiceOnFranchise = franchiseServiceEnabled.get(svcKey) === true;
        const franchiseCategoryOnFranchise = catKey
            ? franchiseCategoryEnabled.get(catKey) === true
            : false;
        const franchiseEnabledFlag = franchiseServiceOnFranchise && franchiseCategoryOnFranchise;

        return annotateCatalogRowWithAvailability(svc, {
            kind: 'service',
            globalActive: globalServiceActive,
            globalCategoryActive,
            franchiseEnabled: franchiseEnabledFlag,
            franchiseCategoryEnabled: franchiseCategoryOnFranchise,
        });
    });
};

const attachRequestedByUser = async (records) => {
    if (!Array.isArray(records) || records.length === 0) return records;

    const requestedByIds = [
        ...new Set(
            records
                .map((record) => record?.requested_by)
                .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
                .map((id) => String(id))
        ),
    ];

    if (requestedByIds.length === 0) return records;

    const users = await User.find({
        _id: { $in: requestedByIds },
        deleted_at: null,
    }).select('name');

    const userMap = new Map(users.map((user) => [String(user._id), user]));

    return records.map((record) => {
        const plainRecord =
            record && typeof record.toObject === 'function' ? record.toObject() : record;
        const requestedById = plainRecord?.requested_by ? String(plainRecord.requested_by) : null;
        const requestedByUser = requestedById ? userMap.get(requestedById) : null;
        return {
            ...plainRecord,
            requested_by: requestedByUser
                ? { id: requestedByUser._id, name: requestedByUser.name }
                : plainRecord.requested_by,
        };
    });
};

/**
 * Pending service requests raised by users under this franchise (matches GET /api/service/getAll?is_request=true scope).
 */
const buildFranchiseRequestServices = async (franchiseOid) => {
    const franchiseUserIds = await getFranchiseUserIdsForScope([franchiseOid]);
    if (franchiseUserIds.length === 0) return [];

    const local = await resolveFranchiseMappingPreferenceMaps(franchiseOid);
    if (!local.ok) return [];

    const franchiseServiceEnabled = local.serviceEnabled;
    const franchiseCategoryEnabled = local.categoryEnabled;

    const requestSvcs = await Service.find({
        deleted_at: null,
        is_request: true,
        requested_by: { $in: franchiseUserIds },
    })
        .select(
            'name desc image_url category_id is_active is_request service_id tax commission payment_type minimum_deposit approval_status rejection_reason requested_by created_at updated_at'
        )
        .populate({ path: 'category_id', select: categoryPopulateSelect, match: { deleted_at: null } })
        .sort({ name: 1 })
        .lean();

    const catIds = [
        ...new Set(
            requestSvcs
                .map((s) => {
                    const c = s.category_id;
                    if (!c) return null;
                    const raw = c._id ? c._id : c;
                    const oid = coerceCatalogObjectId(raw);
                    return oid ? oid.toString() : null;
                })
                .filter(Boolean)
        ),
    ]
        .map((s) => coerceCatalogObjectId(s))
        .filter(Boolean);
    const globalCatActive = await loadGlobalCategoryActiveMap(catIds);

    const rows = requestSvcs.map((svc) => {
        const svcKey = svc._id.toString();
        const catRef = svc.category_id;
        const catKey = catRef ? (catRef._id ? catRef._id.toString() : catRef.toString()) : '';
        const globalServiceActive = isGlobalCatalogRowActive(svc);
        const globalCategoryActive = catKey ? globalCatActive.get(catKey) === true : false;
        const franchiseServiceOnFranchise = franchiseServiceEnabled.get(svcKey) === true;
        const franchiseCategoryOnFranchise = catKey
            ? franchiseCategoryEnabled.get(catKey) === true
            : false;
        const franchiseEnabledFlag = franchiseServiceOnFranchise && franchiseCategoryOnFranchise;

        return annotateCatalogRowWithAvailability(svc, {
            kind: 'service',
            globalActive: globalServiceActive,
            globalCategoryActive,
            franchiseEnabled: franchiseEnabledFlag,
            franchiseCategoryEnabled: franchiseCategoryOnFranchise,
        });
    });
    return attachRequestedByUser(rows);
};

const normalizeFranchiseServiceSearchInput = (searchRaw) => {
    if (searchRaw === undefined || searchRaw === null) return '';
    return String(searchRaw)
        .replace(/\+/g, ' ')
        .trim();
};

const getServiceCategoryName = (svc) => {
    const c = svc.category_id;
    if (!c) return '';
    if (typeof c === 'object' && c !== null && !(c instanceof mongoose.Types.ObjectId)) {
        return c.name != null ? String(c.name) : '';
    }
    return '';
};

const matchesSearchInServiceName = (svc, qLower) => {
    const n = svc.name != null ? String(svc.name).toLowerCase() : '';
    return n.includes(qLower);
};

const matchesSearchInCategoryNameForService = (svc, qLower) => {
    const cn = getServiceCategoryName(svc).toLowerCase();
    return cn.includes(qLower);
};

/**
 * Prefer services whose **name** matches `search`; if none match, keep services whose
 * related **category name** matches (substring, case-insensitive).
 */
const filterAllServicesBySearch = (rows, searchRaw) => {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const trimmed = normalizeFranchiseServiceSearchInput(searchRaw);
    if (!trimmed) return rows;
    const qLower = trimmed.toLowerCase();

    const nameHits = rows.filter((svc) => matchesSearchInServiceName(svc, qLower));
    if (nameHits.length > 0) return nameHits;

    return rows.filter((svc) => matchesSearchInCategoryNameForService(svc, qLower));
};

const parseFranchiseServiceCatalogSort = (query) => {
    const sortByRaw = query.sort_by;
    const sortOrderRaw = query.sort_order ?? query.order;

    let sortBy = 'name';
    if (sortByRaw !== undefined && sortByRaw !== null && String(sortByRaw).trim() !== '') {
        const s = String(sortByRaw).trim().toLowerCase();
        if (
            s !== 'name' &&
            s !== 'id' &&
            s !== '_id' &&
            s !== 'category' &&
            s !== 'category_name'
        ) {
            return { ok: false, message: 'Sort field must be name, id, or category name.' };
        }
        if (s === '_id' || s === 'id') sortBy = 'id';
        else if (s === 'category' || s === 'category_name') sortBy = 'category_name';
        else sortBy = 'name';
    }

    let sortOrder = 1;
    if (sortOrderRaw !== undefined && sortOrderRaw !== null && String(sortOrderRaw).trim() !== '') {
        const o = String(sortOrderRaw).trim().toLowerCase();
        if (o !== 'asc' && o !== 'desc') {
            return { ok: false, message: 'Sort order must be asc or desc.' };
        }
        sortOrder = o === 'desc' ? -1 : 1;
    }

    return { ok: true, sortBy, sortOrder };
};

const sortAllServicesRows = (rows, sortBy, sortOrder) => {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const mult = sortOrder;
    const copy = [...rows];
    copy.sort((a, b) => {
        if (sortBy === 'id') {
            return mult * a._id.toString().localeCompare(b._id.toString());
        }
        if (sortBy === 'category_name') {
            const ca = getServiceCategoryName(a).toLowerCase();
            const cb = getServiceCategoryName(b).toLowerCase();
            const cmp = ca.localeCompare(cb);
            if (cmp !== 0) return mult * cmp;
            const na = (a.name != null ? String(a.name) : '').toLowerCase();
            const nb = (b.name != null ? String(b.name) : '').toLowerCase();
            return mult * na.localeCompare(nb);
        }
        const na = (a.name != null ? String(a.name) : '').toLowerCase();
        const nb = (b.name != null ? String(b.name) : '').toLowerCase();
        return mult * na.localeCompare(nb);
    });
    return copy;
};

const serviceOidFromListEntry = (entry) => {
    const sid = entry && entry.service_id;
    if (!sid) return null;
    if (sid instanceof mongoose.Types.ObjectId) return sid;
    if (typeof sid === 'object' && sid._id) return sid._id;
    return null;
};

const entryMatchesServiceNameInList = (entry, qLower) => {
    const sid = entry && entry.service_id;
    if (!sid || sid instanceof mongoose.Types.ObjectId) return false;
    const n = sid.name != null ? String(sid.name).toLowerCase() : '';
    return n.includes(qLower);
};

const entryMatchesCategoryNameInList = (entry, qLower) => {
    const sid = entry && entry.service_id;
    if (!sid || sid instanceof mongoose.Types.ObjectId) return false;
    const c = sid.category_id;
    if (!c || typeof c !== 'object' || c instanceof mongoose.Types.ObjectId) return false;
    const n = c.name != null ? String(c.name).toLowerCase() : '';
    return n.includes(qLower);
};

/**
 * When `search` / `q` is present, shrink each mapping row's services_list (and matching
 * active_services / inactive_services / services_order) so list responses are not huge.
 * Same rules as filterAllServicesBySearch: service name first, else category name.
 */
const filterFranchiseServiceMappingRecordsBySearch = (records, searchRaw) => {
    const trimmed = normalizeFranchiseServiceSearchInput(searchRaw);
    if (!trimmed || !Array.isArray(records)) return records;
    const qLower = trimmed.toLowerCase();

    return records.map((row) => {
        const plain = row && typeof row.toObject === 'function' ? row.toObject() : { ...row };
        const list = Array.isArray(plain.services_list) ? plain.services_list : [];

        const nameHits = list.filter((e) => entryMatchesServiceNameInList(e, qLower));
        const filtered = nameHits.length > 0 ? nameHits : list.filter((e) => entryMatchesCategoryNameInList(e, qLower));

        const idSet = new Set(
            filtered.map((e) => {
                const oid = serviceOidFromListEntry(e);
                return oid ? oid.toString() : '';
            }).filter(Boolean)
        );

        plain.services_list = filtered;
        plain.active_services = filtered
            .filter((e) => e.is_active)
            .map((e) => serviceOidFromListEntry(e))
            .filter(Boolean);
        plain.inactive_services = filtered
            .filter((e) => !e.is_active)
            .map((e) => serviceOidFromListEntry(e))
            .filter(Boolean);

        if (Array.isArray(plain.services_order)) {
            plain.services_order = plain.services_order.filter((oid) => idSet.has(oid.toString()));
        } else {
            plain.services_order = filtered.map((e) => serviceOidFromListEntry(e)).filter(Boolean);
        }

        return plain;
    });
};

const franchiseMetaFromDoc = (franchise) =>
    franchise
        ? {
              _id: franchise._id,
              name: franchise.name,
              admin_name: franchise.admin_name ?? null,
              is_active: franchise.is_active,
          }
        : null;

const list = async (query, userId) => {
    try {
        console.error(
            '[franchiseService.list] start',
            JSON.stringify({
                franchise_id: query?.franchise_id ?? null,
                page: query?.page,
                limit: query?.limit,
                userId: userId ?? null,
            })
        );

        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;

        const scope = await resolveFranchiseCatalogListScope(query, userId);
        if (!scope.ok) return fail(scope.status, scope.message);

        const listFlags = resolveFranchiseMappingListQuery(query);
        if (!listFlags.ok) return fail(400, listFlags.message);
        const isRequestFilter = resolveEffectiveIsRequestFilter(query, listFlags);

        const franchise = await loadFranchiseForCatalog(scope.franchiseOid);
        if (!franchise) return fail(404, 'Franchise not found.');

        const sortOpts = parseFranchiseServiceCatalogSort(query);
        if (!sortOpts.ok) return fail(400, sortOpts.message);

        let services =
            isRequestFilter === true
                ? await buildFranchiseRequestServices(scope.franchiseOid)
                : await buildAllServicesWithFranchiseMappingStatus(scope.franchiseOid);

        if (listFlags.mappingActiveFilter !== undefined) {
            services = services.filter(
                (svc) => Boolean(svc.franchise_enabled) === listFlags.mappingActiveFilter
            );
        }
        if (isRequestFilter === false) {
            services = services.filter((svc) => Boolean(svc.is_request) === false);
        }

        const searchTerm = query.search ?? query.q;
        services = filterAllServicesBySearch(services, searchTerm);
        services = sortAllServicesRows(services, sortOpts.sortBy, sortOpts.sortOrder);

        const { data, totalItems, totalPages, currentPage } = paginateArray(
            services,
            page,
            limit
        );

        console.error(
            '[franchiseService.list] ok',
            JSON.stringify({ totalItems, totalPages, currentPage, returned: data.length })
        );

        return ok(200, {
            message: 'Franchise service list fetched successfully.',
            franchise: franchiseMetaFromDoc(franchise),
            services: data,
            totalItems,
            totalPages,
            currentPage,
        });
    } catch (error) {
        console.error('[franchiseService.list] failed', error?.message, error?.stack);
        return fail(500, 'Internal server error.', {
            error: error?.message || String(error),
        });
    }
};

const create = async (body) => {
    try {
        const parsedFranchise = parseObjectId(body.franchise_id, 'franchise_id');
        if (!parsedFranchise.ok) return fail(400, parsedFranchise.message);

        const parsedServices = parseServicesListInput(body.services_list || [], 'services_list');
        if (!parsedServices.ok) return fail(400, parsedServices.message);

        const franchise = await ensureFranchise(parsedFranchise.oid);
        if (!franchise) return fail(404, 'Franchise not found.');

        const svcIds = parsedServices.entries.map((e) => e.service_id);
        const validServices = await ensureServices(svcIds);
        if (!validServices) return fail(400, 'One or more service IDs are invalid or deleted.');

        const activeIds = activeServiceIdsFromListEntries(parsedServices.entries);
        const saved = await saveFranchiseServices(parsedFranchise.oid, activeIds);
        if (!saved) return fail(404, 'Franchise not found.');

        const record = await buildServiceMappingRecordFromFranchise(parsedFranchise.oid);
        return ok(200, {
            message: 'Franchise service created successfully.',
            record: coerceLegacyServiceMappingArrays(record),
        });
    } catch (error) {
        console.error('franchiseService.create', error.message);
        return fail(500, 'Internal server error.');
    }
};

const getById = async (id, userId, query = {}) => {
    try {
        const parsed = parseObjectId(id, 'id');
        if (!parsed.ok) return fail(400, parsed.message);

        const franchise = await loadFranchiseForCatalog(parsed.oid);
        if (!franchise) return fail(404, 'No record found');

        if (userId) {
            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');
            if (auth.isFranchiseAdmin || auth.isEmployee) {
                if (!auth.franchise_id || String(franchise._id) !== String(auth.franchise_id)) {
                    return fail(403, 'Access denied.');
                }
            } else if (!auth.isSuper) {
                return fail(403, 'Access denied.');
            }
        }

        const listFlags = resolveFranchiseMappingListQuery(query);
        if (!listFlags.ok) return fail(400, listFlags.message);

        const record = await buildServiceMappingRecordFromFranchise(parsed.oid);
        const afterCatalog = applyServiceCatalogFiltersToRecords(
            record ? [record] : [],
            undefined,
            listFlags.isRequestFilter
        ).map((row) => coerceLegacyServiceMappingArrays(row));
        let [recordOut] = filterRecordsByFranchiseMappingToggle(
            afterCatalog,
            listFlags.mappingActiveFilter,
            'services_list',
            'active_services',
            'inactive_services',
            'service_id'
        );
        const enrichedRows = await enrichFranchiseServiceMappingRecords(recordOut ? [recordOut] : []);
        recordOut = enrichedRows[0] || recordOut;
        return ok(200, {
            message: 'Franchise service fetched successfully.',
            record: recordOut,
        });
    } catch (error) {
        console.error('franchiseService.getById', error.message);
        return fail(500, 'Internal server error.');
    }
};

const update = async (id, body, userId) => {
    try {
        const parsed = parseObjectId(id, 'id');
        if (!parsed.ok) return fail(400, parsed.message);

        const franchise = await loadFranchiseForCatalog(parsed.oid);
        if (!franchise) return fail(404, 'No record found');

        const beforeServiceIds = [...(franchise.services || [])];
        let nextServiceIds = [...beforeServiceIds];

        if (body.franchise_id !== undefined) {
            const parsedFranchise = parseObjectId(body.franchise_id, 'franchise_id');
            if (!parsedFranchise.ok) return fail(400, parsedFranchise.message);
            const targetFranchise = await ensureFranchise(parsedFranchise.oid);
            if (!targetFranchise) return fail(404, 'Franchise not found.');
            if (String(parsedFranchise.oid) !== String(parsed.oid)) {
                return fail(400, 'Franchise must match the record id.');
            }
        }

        if (body.services_list !== undefined) {
            const parsedServices = parseServicesListInput(body.services_list, 'services_list');
            if (!parsedServices.ok) return fail(400, parsedServices.message);
            const svcIds = parsedServices.entries.map((e) => e.service_id);
            const validServices = await ensureServices(svcIds);
            if (!validServices) return fail(400, 'One or more service IDs are invalid or deleted.');

            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');

            if (auth.isSuper) {
                nextServiceIds = activeServiceIdsFromListEntries(parsedServices.entries);
            } else if (auth.isEmployee) {
                return fail(403, 'Franchise employees cannot update services list.');
            } else if (auth.isFranchiseAdmin) {
                if (String(franchise._id) !== String(auth.franchise_id)) {
                    return fail(403, 'Access denied.');
                }
                nextServiceIds = activeServiceIdsFromListEntries(parsedServices.entries);
            } else {
                return fail(403, 'Access denied.');
            }
        }

        const isStatusEditRequest =
            body.active_services !== undefined || body.inactive_services !== undefined;

        if (isStatusEditRequest) {
            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');

            const franchiseAdmin = await Franchise.findOne({
                _id: franchise._id,
                deleted_at: null,
            })
                .select('admin_id services')
                .lean();
            if (!franchiseAdmin) return fail(404, 'Franchise not found.');

            const canEditStatus = auth.isSuper || String(franchiseAdmin.admin_id) === String(userId);
            if (!canEditStatus) {
                return fail(
                    403,
                    'Only this franchise admin or a super admin can update active/inactive service lists.'
                );
            }

            const virtual = await buildVirtualServiceMappingRecord(franchiseAdmin);
            const normList = normalizeStoredServicesList(virtual?.services_list || []);
            const catalogStr = new Set(normList.map((e) => e.service_id.toString()));

            let activeIds;
            let inactiveIds;
            if (body.active_services !== undefined && body.inactive_services !== undefined) {
                const pa = parseObjectIdArray(body.active_services, 'active_services');
                if (!pa.ok) return fail(400, pa.message);
                const pi = parseObjectIdArray(body.inactive_services, 'inactive_services');
                if (!pi.ok) return fail(400, pi.message);
                activeIds = pa.oids;
                inactiveIds = pi.oids;
            } else if (body.active_services !== undefined) {
                const pa = parseObjectIdArray(body.active_services, 'active_services');
                if (!pa.ok) return fail(400, pa.message);
                activeIds = pa.oids;
                const activeStr = new Set(activeIds.map((a) => a.toString()));
                inactiveIds = normList
                    .filter((e) => !activeStr.has(e.service_id.toString()))
                    .map((e) => e.service_id);
            } else {
                const pi = parseObjectIdArray(body.inactive_services, 'inactive_services');
                if (!pi.ok) return fail(400, pi.message);
                inactiveIds = pi.oids;
                const inactiveStr = new Set(inactiveIds.map((a) => a.toString()));
                activeIds = normList
                    .filter((e) => !inactiveStr.has(e.service_id.toString()))
                    .map((e) => e.service_id);
            }

            const partitionCheck = validateServiceActiveInactivePartition(
                catalogStr,
                activeIds,
                inactiveIds
            );
            if (!partitionCheck.ok) return fail(400, partitionCheck.message);

            nextServiceIds = activeIds;
        }

        if (body.services_order !== undefined) {
            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');
            if (auth.isEmployee) {
                return fail(403, 'Franchise employees cannot update services order.');
            }
            const canEditOrder =
                auth.isSuper ||
                (auth.isFranchiseAdmin && String(franchise._id) === String(auth.franchise_id));
            if (!canEditOrder) {
                return fail(403, 'Access denied.');
            }
            const virtual = await buildVirtualServiceMappingRecord(franchise);
            const normListOrder = normalizeStoredServicesList(virtual?.services_list || []);
            const catalogStrOrder = new Set(normListOrder.map((e) => e.service_id.toString()));
            const po = parseObjectIdArrayOrdered(body.services_order, 'services_order');
            if (!po.ok) return fail(400, po.message);
            const orderCheck = validateServicesOrderPermutation(po.oids, catalogStrOrder);
            if (!orderCheck.ok) return fail(400, orderCheck.message);
            nextServiceIds = applyServiceOrderToFranchiseIds(nextServiceIds, po.oids);
        }

        const removedServiceIds = diffRemovedIds(beforeServiceIds, nextServiceIds);

        const freshFranchise = await Franchise.findOne({ _id: franchise._id, deleted_at: null })
            .select('categories')
            .lean();
        const enabledCategoryIds = freshFranchise?.categories || [];

        const allowedServiceIds = await filterServiceIdsToFranchiseEnabledCategories(
            enabledCategoryIds,
            nextServiceIds
        );
        const allowedSet = new Set(allowedServiceIds.map((id) => toIdStr(id)));
        const beforeSet = new Set(beforeServiceIds.map((id) => toIdStr(id)));
        const blockedEnable = nextServiceIds.filter((id) => {
            const key = toIdStr(id);
            return key && !beforeSet.has(key) && !allowedSet.has(key);
        });
        if (blockedEnable.length > 0) {
            return fail(
                400,
                'Cannot enable services whose category is not enabled on this franchise. Enable the parent category first.'
            );
        }
        nextServiceIds = allowedServiceIds;

        const saved = await saveFranchiseServices(franchise._id, nextServiceIds);
        if (!saved) return fail(404, 'Franchise not found.');

        if (removedServiceIds.length > 0) {
            try {
                await onFranchiseServicesRemoved(franchise._id, removedServiceIds);
            } catch (cascadeErr) {
                console.error('franchiseService.update cascade failed:', cascadeErr.message);
            }
        }

        const record = await buildServiceMappingRecordFromFranchise(franchise._id);
        return ok(200, {
            message: 'Franchise service updated successfully.',
            record: coerceLegacyServiceMappingArrays(record),
        });
    } catch (error) {
        console.error('franchiseService.update', error.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    list,
    create,
    getById,
    update,
};
