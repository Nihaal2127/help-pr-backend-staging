const mongoose = require('mongoose');
const FranchiseService = require('../models/franchise_service');
const Franchise = require('../models/franchise');
const Service = require('../models/service');
const User = require('../models/user');
const { applyPagination } = require('../utils/pagination');
const {
    normalizeStoredServicesList,
    parseObjectIdArray,
    parseObjectIdArrayOrdered,
    coerceLegacyServiceMappingArrays,
    validateServiceActiveInactivePartition,
    validateServicesOrderPermutation,
    filterRecordsByFranchiseMappingToggle,
} = require('../utils/franchise_catalog_lists');

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
        return { ok: false, message: `${fieldName} must be a valid MongoDB ObjectId.` };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(value) };
};

const parseServicesListInput = (raw, fieldName) => {
    if (!Array.isArray(raw)) return { ok: false, message: `${fieldName} must be an array.` };
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

const parseOptionalQueryBool = (raw, fieldName) => {
    if (raw === undefined || raw === null) return { ok: true, present: false };
    const s = String(raw).trim().toLowerCase();
    if (s === '') return { ok: true, present: false };
    if (s === 'true' || s === '1') return { ok: true, present: true, value: true };
    if (s === 'false' || s === '0') return { ok: true, present: true, value: false };
    return { ok: false, message: `${fieldName} must be true or false.` };
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
    if (!userId) return null;
    const user = await User.findOne({ _id: userId, deleted_at: null }).select('type franchise_id');
    if (!user) return null;
    const t = Number(user.type);
    const isSuper = t === USER_TYPE_SUPER_ADMIN || t === USER_TYPE_STAFF;
    const isFranchiseAdmin = t === USER_TYPE_ADMIN && user.franchise_id;
    const isEmployee = t === USER_TYPE_EMPLOYEE && user.franchise_id;
    return { user, isSuper, isFranchiseAdmin, isEmployee, franchise_id: user.franchise_id };
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

const categoryPopulateSelect = 'name desc image_url is_active is_request category_id';

const listPopulateFields = [
    { path: 'franchise_id', select: 'name admin_name is_active' },
    {
        path: 'services_list',
        populate: {
            path: 'service_id',
            select: 'name desc image_url category_id is_active is_request',
            populate: {
                path: 'category_id',
                select: categoryPopulateSelect,
                match: { deleted_at: null },
            },
        },
    },
];

/** When no FranchiseService row exists (legacy / missing mapping), mirror Franchise.services as active mappings. */
const buildSyntheticFranchiseServiceFromFranchiseDoc = async (franchiseOid) => {
    const fr = await Franchise.findOne({ _id: franchiseOid, deleted_at: null }).select('services').lean();
    if (!fr || !Array.isArray(fr.services) || fr.services.length === 0) return null;
    const row = {
        _id: new mongoose.Types.ObjectId(),
        franchise_id: franchiseOid,
        services_list: fr.services.map((service_id) => ({ service_id, is_active: true })),
        active_services: [...fr.services],
        inactive_services: [],
        services_order: [...fr.services],
        order_number: 0,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        synthetic_from_franchise: true,
    };
    const populated = await FranchiseService.populate([row], listPopulateFields);
    return populated[0];
};

/**
 * Every global service (non-deleted), each with franchise_active derived from the latest
 * franchise_service mapping for this franchise (active_services after coerce).
 */
const buildAllServicesWithFranchiseMappingStatus = async (franchiseOid) => {
    const row = await FranchiseService.findOne({
        franchise_id: franchiseOid,
        deleted_at: null,
    })
        .sort({ created_at: -1 })
        .lean();

    let plainForCoerce = row;
    if (!row) {
        const synthetic = await buildSyntheticFranchiseServiceFromFranchiseDoc(franchiseOid);
        if (synthetic) {
            plainForCoerce =
                typeof synthetic.toObject === 'function' ? synthetic.toObject() : { ...synthetic };
        }
    }

    const activeSet = new Set();
    if (plainForCoerce) {
        const coerced = coerceLegacyServiceMappingArrays(plainForCoerce);
        (coerced.active_services || []).forEach((id) => activeSet.add(id.toString()));
    }

    const allSvcs = await Service.find({ deleted_at: null })
        .populate({
            path: 'category_id',
            select: categoryPopulateSelect,
            match: { deleted_at: null },
        })
        .lean();

    return allSvcs.map((svc) => ({
        ...svc,
        franchise_active: activeSet.has(svc._id.toString()),
    }));
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
    const trimmed =
        searchRaw !== undefined && searchRaw !== null ? String(searchRaw).trim() : '';
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
            return { ok: false, message: 'sort_by must be name, id, or category_name.' };
        }
        if (s === '_id' || s === 'id') sortBy = 'id';
        else if (s === 'category' || s === 'category_name') sortBy = 'category_name';
        else sortBy = 'name';
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

        let { data, totalCount, totalPages, currentPage } = await applyPagination(
            FranchiseService,
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
            const synthetic = await buildSyntheticFranchiseServiceFromFranchiseDoc(filter.franchise_id);
            if (synthetic) {
                data = [synthetic];
                totalCount = 1;
                totalPages = 1;
            }
        }

        const records = filterRecordsByFranchiseMappingToggle(
            applyServiceCatalogFiltersToRecords(
                data,
                undefined,
                listFlags.isRequestFilter
            ).map((row) => coerceLegacyServiceMappingArrays(row)),
            listFlags.mappingActiveFilter,
            'services_list',
            'active_services',
            'inactive_services',
            'service_id'
        );

        let all_services;
        if (filter.franchise_id) {
            const sortOpts = parseFranchiseServiceCatalogSort(query);
            if (!sortOpts.ok) return fail(400, sortOpts.message);

            all_services = await buildAllServicesWithFranchiseMappingStatus(filter.franchise_id);
            const searchTerm = query.search ?? query.q;
            all_services = filterAllServicesBySearch(all_services, searchTerm);
            all_services = sortAllServicesRows(
                all_services,
                sortOpts.sortBy,
                sortOpts.sortOrder
            );
        }

        return ok(200, {
            message: 'Franchise service list fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage,
            records,
            ...(all_services !== undefined && { all_services }),
        });
    } catch (error) {
        console.error('franchiseService.list', error.message);
        return fail(500, 'Internal server error.');
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

        const activeSvc = parsedServices.entries.filter((e) => e.is_active).map((e) => e.service_id);
        const inactiveSvc = parsedServices.entries.filter((e) => !e.is_active).map((e) => e.service_id);
        const servicesOrderIds = parsedServices.entries.map((e) => e.service_id);

        const doc = new FranchiseService({
            franchise_id: parsedFranchise.oid,
            services_list: parsedServices.entries,
            active_services: activeSvc,
            inactive_services: inactiveSvc,
            services_order: servicesOrderIds,
            order_number:
                body.order_number !== undefined && body.order_number !== null
                    ? Number(body.order_number)
                    : 0,
        });

        const saved = await doc.save();
        return ok(200, {
            message: 'Franchise service created successfully.',
            record: coerceLegacyServiceMappingArrays(saved),
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
        const record = await FranchiseService.findOne({ _id: parsed.oid, deleted_at: null });
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
        const afterCatalog = applyServiceCatalogFiltersToRecords(
            [record],
            undefined,
            listFlags.isRequestFilter
        ).map((row) => coerceLegacyServiceMappingArrays(row));
        const [recordOut] = filterRecordsByFranchiseMappingToggle(
            afterCatalog,
            listFlags.mappingActiveFilter,
            'services_list',
            'active_services',
            'inactive_services',
            'service_id'
        );
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

        const record = await FranchiseService.findOne({ _id: parsed.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');

        if (body.franchise_id !== undefined) {
            const parsedFranchise = parseObjectId(body.franchise_id, 'franchise_id');
            if (!parsedFranchise.ok) return fail(400, parsedFranchise.message);
            const franchise = await ensureFranchise(parsedFranchise.oid);
            if (!franchise) return fail(404, 'Franchise not found.');
            record.franchise_id = parsedFranchise.oid;
        }

        if (body.services_list !== undefined) {
            const parsedServices = parseServicesListInput(body.services_list, 'services_list');
            if (!parsedServices.ok) return fail(400, parsedServices.message);
            const svcIds = parsedServices.entries.map((e) => e.service_id);
            const validServices = await ensureServices(svcIds);
            if (!validServices) return fail(400, 'One or more service IDs are invalid or deleted.');

            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');

            const servicesOrderFromEntries = parsedServices.entries.map((e) => e.service_id);

            if (auth.isSuper) {
                record.services_list = parsedServices.entries;
                record.active_services = parsedServices.entries
                    .filter((e) => e.is_active)
                    .map((e) => e.service_id);
                record.inactive_services = parsedServices.entries
                    .filter((e) => !e.is_active)
                    .map((e) => e.service_id);
                record.services_order = servicesOrderFromEntries;
            } else if (auth.isEmployee) {
                return fail(403, 'Franchise employees cannot update services list.');
            } else if (auth.isFranchiseAdmin) {
                if (String(record.franchise_id) !== String(auth.franchise_id)) {
                    return fail(403, 'Access denied.');
                }
                record.services_list = parsedServices.entries;
                record.active_services = parsedServices.entries
                    .filter((e) => e.is_active)
                    .map((e) => e.service_id);
                record.inactive_services = parsedServices.entries
                    .filter((e) => !e.is_active)
                    .map((e) => e.service_id);
                record.services_order = servicesOrderFromEntries;
            } else {
                return fail(403, 'Access denied.');
            }
        }

        const isStatusEditRequest =
            body.active_services !== undefined || body.inactive_services !== undefined;

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
                    'Only this franchise admin or a super admin can update active/inactive service lists.'
                );
            }

            const normList = normalizeStoredServicesList(record.services_list);
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

            record.active_services = activeIds;
            record.inactive_services = inactiveIds;
        }

        if (body.services_order !== undefined) {
            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');
            if (auth.isEmployee) {
                return fail(403, 'Franchise employees cannot update services order.');
            }
            const canEditOrder =
                auth.isSuper ||
                (auth.isFranchiseAdmin &&
                    String(record.franchise_id) === String(auth.franchise_id));
            if (!canEditOrder) {
                return fail(403, 'Access denied.');
            }
            const normListOrder = normalizeStoredServicesList(record.services_list);
            const catalogStrOrder = new Set(normListOrder.map((e) => e.service_id.toString()));
            const po = parseObjectIdArrayOrdered(body.services_order, 'services_order');
            if (!po.ok) return fail(400, po.message);
            const orderCheck = validateServicesOrderPermutation(po.oids, catalogStrOrder);
            if (!orderCheck.ok) return fail(400, orderCheck.message);
            record.services_order = po.oids;
        }

        if (body.order_number !== undefined) {
            record.order_number = Number(body.order_number);
        }

        record.updated_at = new Date();
        const updated = await record.save();
        return ok(200, {
            message: 'Franchise service updated successfully.',
            record: coerceLegacyServiceMappingArrays(updated),
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
