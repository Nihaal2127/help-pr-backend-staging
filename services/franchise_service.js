const mongoose = require('mongoose');
const { fieldLabel } = require('../utils/field_labels');
const Franchise = require('../models/franchise');
const Category = require('../models/category');
const Service = require('../models/service');
const State = require('../models/state');
const City = require('../models/city');
const Area = require('../models/area');
const User = require('../models/user');
const Address = require('../models/address');
const PartnerService = require('../models/partner_service');
const PartnerCategory = require('../models/partner_category');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { loadFranchiseCallerScope } = require('../utils/franchise_user_scope');
const {
    resolveFranchiseEffectiveCatalog,
    computeServiceEffectiveActive,
    computeCategoryEffectiveActive,
    isGlobalCatalogRowActive,
} = require('../utils/catalog_availability_resolver');
const { parseBoolean } = require('../utils/parser');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const {
    franchiseNameExistsQuery,
    normalizeFranchiseName,
} = require('../utils/franchise_name_uniqueness');

const parseObjectId = (raw, fieldName = 'id') => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!s || !/^[a-fA-F0-9]{24}$/.test(s)) {
        return {
            ok: false,
            message: `${fieldLabel(fieldName)} must be a valid MongoDB ObjectId (24 hex characters).`,
        };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

/** String fields use en collation (strength 2) so "south" sorts before "West" instead of binary Unicode order (uppercase before lowercase). */
const FRANCHISE_STRING_SORT_FIELDS = ['name', 'state_name', 'city_name', 'admin_name', 'contact'];
const FRANCHISE_LIST_COLLATION = { locale: 'en', strength: 2 };

/** Query: sort_by / sortBy = name | created_at | state_name | city_name | admin_name | contact; sort_order / sortOrder = asc | desc. Legacy: sort=1|-1 on created_at when sort_by omitted. */
const FRANCHISE_LIST_SORT_FIELDS = [
    ...FRANCHISE_STRING_SORT_FIELDS,
    'created_at',
];

const buildFranchiseListSort = (query) => {
    const sortByRaw = query.sort_by ?? query.sortBy;
    const orderRaw = String(query.sort_order ?? query.sortOrder ?? '').toLowerCase();

    if (!sortByRaw) {
        const legacy = query.sort !== undefined ? parseInt(query.sort, 10) : NaN;
        const dir = legacy === 1 || legacy === -1 ? legacy : -1;
        return { sort: { created_at: dir }, collation: undefined };
    }

    const sortBy = FRANCHISE_LIST_SORT_FIELDS.includes(sortByRaw) ? sortByRaw : 'created_at';

    let direction;
    if (orderRaw === 'asc' || orderRaw === '1') direction = 1;
    else if (orderRaw === 'desc' || orderRaw === '-1') direction = -1;
    else direction = sortBy === 'created_at' ? -1 : 1;

    const sort = { [sortBy]: direction };
    const collation = FRANCHISE_STRING_SORT_FIELDS.includes(sortBy) ? FRANCHISE_LIST_COLLATION : undefined;

    return { sort, collation };
};

const parseObjectIdArray = (raw, fieldName) => {
    if (raw === undefined || raw === null) {
        return { ok: true, oids: undefined };
    }
    if (!Array.isArray(raw)) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be an array.` };
    }
    const oids = [];
    for (const item of raw) {
        const p = parseObjectId(item, fieldName);
        if (!p.ok) return { ok: false, message: p.message };
        oids.push(p.oid);
    }
    return { ok: true, oids: dedupeIdsPreserveOrder(oids) };
};

const validateCategoryIds = async (oids) => {
    if (!oids || oids.length === 0) return { ok: true };
    const count = await Category.countDocuments({
        _id: { $in: oids },
        deleted_at: null,
    });
    if (count !== oids.length) {
        return {
            ok: false,
            message: 'One or more category IDs are invalid or deleted.',
        };
    }
    return { ok: true };
};

const validateServiceIds = async (oids) => {
    if (!oids || oids.length === 0) return { ok: true };
    const count = await Service.countDocuments({
        _id: { $in: oids },
        deleted_at: null,
    });
    if (count !== oids.length) {
        return {
            ok: false,
            message: 'One or more service IDs are invalid or deleted.',
        };
    }
    return { ok: true };
};

const dedupeIdsPreserveOrder = (oids) => {
    const seen = new Set();
    const out = [];
    for (const oid of oids) {
        const s = oid.toString();
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(oid);
    }
    return out;
};

const normalizeDescriptionFields = (body) => {
    let description = body.description !== undefined ? String(body.description) : '';
    let desc = body.desc !== undefined ? body.desc : null;
    if (desc !== null && desc !== undefined) desc = String(desc);
    if (!description.trim() && desc && String(desc).trim()) {
        description = String(desc).trim();
    }
    if (desc === null || desc === undefined || !String(desc).trim()) {
        desc = description.trim() || null;
    }
    return { description: description.trim(), desc: desc || null };
};

const loadState = async (stateOid) =>
    State.findOne({ _id: stateOid, deleted_at: null });

const loadCityUnderState = async (cityOid, stateOid) => {
    const city = await City.findOne({ _id: cityOid, deleted_at: null });
    if (!city) return null;
    if (city.state_id.toString() !== stateOid.toString()) {
        return { mismatch: true, city };
    }
    return { city };
};

const resolveAreasForCity = async (areaIdsRaw, cityOid) => {
    if (!areaIdsRaw || !Array.isArray(areaIdsRaw) || areaIdsRaw.length === 0) {
        return { ok: true, area_ids: [], area_names: [] };
    }
    const oids = [];
    for (const raw of areaIdsRaw) {
        const p = parseObjectId(raw, 'area_id');
        if (!p.ok) return { ok: false, message: p.message };
        oids.push(p.oid);
    }
    const uniqueOids = dedupeIdsPreserveOrder(oids);
    const areas = await Area.find({
        _id: { $in: uniqueOids },
        city_id: cityOid,
        deleted_at: null,
    }).lean();
    if (areas.length !== uniqueOids.length) {
        return {
            ok: false,
            message:
                'One or more areas are invalid, deleted, or do not belong to the selected city.',
        };
    }
    const map = new Map(areas.map((a) => [a._id.toString(), a.name]));
    const area_names = uniqueOids.map((oid) => map.get(oid.toString()) || '');
    return { ok: true, area_ids: uniqueOids, area_names };
};

const loadAdmin = async (adminOid) => {
    const user = await User.findOne({ _id: adminOid, deleted_at: null }).select('name email');
    if (!user) return null;
    const admin_name = user.name || user.email || 'Admin';
    return { user, admin_name };
};

const validateFranchiseHierarchy = async ({
    state_id,
    city_id,
    area_id,
}) => {
    const pState = parseObjectId(state_id, 'state_id');
    if (!pState.ok) return { ok: false, message: pState.message };
    const pCity = parseObjectId(city_id, 'city_id');
    if (!pCity.ok) return { ok: false, message: pCity.message };

    const state = await loadState(pState.oid);
    if (!state) return { ok: false, status: 404, message: 'State not found.' };

    const cityRes = await loadCityUnderState(pCity.oid, pState.oid);
    if (!cityRes) return { ok: false, status: 404, message: 'City not found.' };
    if (cityRes.mismatch) {
        return { ok: false, status: 400, message: 'City does not belong to the selected state.' };
    }

    const areasRes = await resolveAreasForCity(area_id, pCity.oid);
    if (!areasRes.ok) return { ok: false, status: 400, message: areasRes.message };

    return {
        ok: true,
        state,
        city: cityRes.city,
        area_ids: areasRes.area_ids,
        area_names: areasRes.area_names,
        stateOid: pState.oid,
        cityOid: pCity.oid,
    };
};

const listFranchises = async (query) => {
    try {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const filter = {
            deleted_at: null,
            ...(query.is_active !== undefined && {
                is_active: parseBoolean(query.is_active),
            }),
        };
        const nameSearchRaw = query.name ?? query.keyword ?? query.search;
        if (nameSearchRaw !== undefined && nameSearchRaw !== null) {
            const s = String(Array.isArray(nameSearchRaw) ? nameSearchRaw[0] : nameSearchRaw).trim();
            if (s) {
                const pattern = new RegExp(sanitizeInput(s), 'i');
                filter.$or = [
                    { name: { $regex: pattern } },
                    { admin_name: { $regex: pattern } },
                    { state_name: { $regex: pattern } },
                    { city_name: { $regex: pattern } },
                    { area_name: { $regex: pattern } },
                ];
            }
        }
        if (query.state_id) {
            const p = parseObjectId(query.state_id, 'state_id');
            if (!p.ok) return fail(400, p.message);
            filter.state_id = p.oid;
        }
        if (query.city_id) {
            const p = parseObjectId(query.city_id, 'city_id');
            if (!p.ok) return fail(400, p.message);
            filter.city_id = p.oid;
        }
        if (query.admin_id) {
            const p = parseObjectId(query.admin_id, 'admin_id');
            if (!p.ok) return fail(400, p.message);
            filter.admin_id = p.oid;
        }

        const { sort, collation } = buildFranchiseListSort(query);

        const { data: rows, totalCount, totalPages, currentPage } = await applyPagination(
            Franchise,
            filter,
            page,
            limit,
            sort,
            {},
            [],
            collation ? { collation } : {}
        );

        return ok(200, {
            message: 'Franchise list fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage,
            records: rows,
        });
    } catch (err) {
        console.log('listFranchises', err.message);
        return fail(500, 'Internal server error.');
    }
};

const createFranchise = async (body) => {
    try {
        const {
            name,
            state_id,
            city_id,
            area_id,
            admin_id,
            contact,
            is_active,
            desc2,
        } = body;

        const pAdmin = parseObjectId(admin_id, 'admin_id');
        if (!pAdmin.ok) return fail(400, pAdmin.message);

        const adminCtx = await loadAdmin(pAdmin.oid);
        if (!adminCtx) return fail(404, 'Admin user not found.');

        const hierarchy = await validateFranchiseHierarchy({
            state_id,
            city_id,
            area_id,
        });
        if (!hierarchy.ok) return fail(hierarchy.status || 400, hierarchy.message);

        const parsedCategories = parseObjectIdArray(body.categories, 'categories');
        if (!parsedCategories.ok) return fail(400, parsedCategories.message);
        const parsedServices = parseObjectIdArray(body.services, 'services');
        if (!parsedServices.ok) return fail(400, parsedServices.message);

        const categoryOids =
            parsedCategories.oids !== undefined ? parsedCategories.oids : [];
        const serviceOids = parsedServices.oids !== undefined ? parsedServices.oids : [];

        const catCheck = await validateCategoryIds(categoryOids);
        if (!catCheck.ok) return fail(400, catCheck.message);
        const svcCheck = await validateServiceIds(serviceOids);
        if (!svcCheck.ok) return fail(400, svcCheck.message);

        const { description, desc } = normalizeDescriptionFields(body);

        const trimmedName = normalizeFranchiseName(name);
        if (!trimmedName) {
            return fail(400, 'Franchise name is required.');
        }

        const existing = await Franchise.findOne(franchiseNameExistsQuery(trimmedName));
        if (existing) {
            return fail(409, 'Franchise name already exists.');
        }

        const doc = new Franchise({
            name: trimmedName,
            state_id: hierarchy.stateOid,
            state_name: hierarchy.state.name,
            city_id: hierarchy.cityOid,
            city_name: hierarchy.city.name,
            area_id: hierarchy.area_ids,
            area_name: hierarchy.area_names,
            admin_id: pAdmin.oid,
            admin_name: adminCtx.admin_name,
            description,
            desc,
            desc2: desc2 !== undefined && desc2 !== null ? String(desc2) : null,
            contact:
                contact !== undefined && contact !== null
                    ? String(contact).trim()
                    : '',
            categories: categoryOids,
            services: serviceOids,
            is_active,
        });

        const saved = await doc.save();
        return ok(200, { message: 'Franchise created successfully.', record: saved });
    } catch (error) {
        console.error('createFranchise', error.message);
        return fail(500, 'Internal server error.');
    }
};

const updateFranchise = async (id, body) => {
    const updateData = { ...body };
    delete updateData.state_name;
    delete updateData.city_name;
    delete updateData.area_name;
    delete updateData.admin_name;

    try {
        const franchise = await Franchise.findById(id);
        if (!franchise) return fail(404, 'No record found');

        const stateIdInput = body.state_id !== undefined ? body.state_id : franchise.state_id;
        const cityIdInput = body.city_id !== undefined ? body.city_id : franchise.city_id;
        const areaIdInput = body.area_id !== undefined ? body.area_id : franchise.area_id;

        const hierarchy = await validateFranchiseHierarchy({
            state_id: stateIdInput,
            city_id: cityIdInput,
            area_id: areaIdInput,
        });
        if (!hierarchy.ok) return fail(hierarchy.status || 400, hierarchy.message);

        if (body.admin_id !== undefined) {
            const pAdmin = parseObjectId(body.admin_id, 'admin_id');
            if (!pAdmin.ok) return fail(400, pAdmin.message);
            const adminCtx = await loadAdmin(pAdmin.oid);
            if (!adminCtx) return fail(404, 'Admin user not found.');
            franchise.admin_id = pAdmin.oid;
            franchise.admin_name = adminCtx.admin_name;
            delete updateData.admin_id;
        }

        if (body.name !== undefined) {
            const trimmedName = normalizeFranchiseName(body.name);
            if (!trimmedName) {
                return fail(400, 'Franchise name is required.');
            }
            const existing = await Franchise.findOne(franchiseNameExistsQuery(trimmedName, id));
            if (existing) return fail(409, 'Franchise name already exists.');
            franchise.name = trimmedName;
        }

        franchise.state_id = hierarchy.stateOid;
        franchise.state_name = hierarchy.state.name;
        franchise.city_id = hierarchy.cityOid;
        franchise.city_name = hierarchy.city.name;
        franchise.area_id = hierarchy.area_ids;
        franchise.area_name = hierarchy.area_names;

        if (body.description !== undefined || body.desc !== undefined) {
            const { description, desc } = normalizeDescriptionFields({
                description: body.description !== undefined ? body.description : franchise.description,
                desc: body.desc !== undefined ? body.desc : franchise.desc,
            });
            franchise.description = description;
            franchise.desc = desc;
            delete updateData.description;
            delete updateData.desc;
        }

        if (body.desc2 !== undefined) {
            franchise.desc2 = body.desc2 !== null ? String(body.desc2) : null;
            delete updateData.desc2;
        }

        if (body.contact !== undefined) {
            franchise.contact = String(body.contact).trim();
            delete updateData.contact;
        }
        if (body.is_active !== undefined) {
            franchise.is_active = body.is_active;
            delete updateData.is_active;
        }

        if (body.categories !== undefined) {
            const parsedCategories = parseObjectIdArray(body.categories, 'categories');
            if (!parsedCategories.ok) return fail(400, parsedCategories.message);
            const catCheck = await validateCategoryIds(parsedCategories.oids);
            if (!catCheck.ok) return fail(400, catCheck.message);
            franchise.categories = parsedCategories.oids;
            delete updateData.categories;
        }
        if (body.services !== undefined) {
            const parsedServices = parseObjectIdArray(body.services, 'services');
            if (!parsedServices.ok) return fail(400, parsedServices.message);
            const svcCheck = await validateServiceIds(parsedServices.oids);
            if (!svcCheck.ok) return fail(400, svcCheck.message);
            franchise.services = parsedServices.oids;
            delete updateData.services;
        }

        delete updateData.state_id;
        delete updateData.city_id;
        delete updateData.area_id;

        franchise.updated_at = new Date();
        const updated = await franchise.save();
        return ok(200, { message: 'Franchise updated successfully', record: updated });
    } catch (error) {
        console.error('updateFranchise', error.message);
        return fail(500, 'Internal server error.');
    }
};

const getFranchiseById = async (id) => {
    try {
        const record = await Franchise.findById(id);
        if (!record) return fail(404, 'No record found');
        return ok(200, { message: 'Franchise fetched successfully', record });
    } catch (error) {
        console.error('getFranchiseById', error);
        return fail(500, 'Internal server error.');
    }
};

const softDeleteFranchise = async (id) => {
    try {
        const row = await Franchise.findById(id);
        if (!row) return fail(404, 'No record found');
        if (row.deleted_at) return fail(400, 'Franchise is already deleted');

        row.deleted_at = new Date();
        await row.save();
        return ok(200, { message: 'Franchise deleted successfully' });
    } catch (error) {
        console.error('softDeleteFranchise', error);
        return fail(500, 'Internal server error.');
    }
};

const importFranchises = async (records) => {
    if (!records || !Array.isArray(records)) {
        return fail(400, 'Invalid input. Expected an array of records.');
    }
    if (records.length === 0) {
        return fail(400, 'Please add records in excel sheet.');
    }

    try {
        const toInsert = [];
        for (const rec of records) {
            if (!rec.name || !rec.state_id || !rec.city_id || !rec.admin_id) {
                return fail(400, 'Each record must include name, state, city, and admin.');
            }
            const trimmedName = String(rec.name).trim();
            if (!trimmedName) {
                return fail(400, 'Each record must include a non-empty franchise name.');
            }
            const hierarchy = await validateFranchiseHierarchy({
                state_id: rec.state_id,
                city_id: rec.city_id,
                area_id: rec.area_id,
            });
            if (!hierarchy.ok) {
                return fail(hierarchy.status || 400, `${hierarchy.message} (franchise: ${rec.name})`);
            }
            const pAdmin = parseObjectId(rec.admin_id, 'admin_id');
            if (!pAdmin.ok) return fail(400, pAdmin.message);
            const adminCtx = await loadAdmin(pAdmin.oid);
            if (!adminCtx) {
                return fail(400, `Admin user not found for franchise: ${trimmedName}`);
            }
            const nameConflict = await Franchise.findOne(franchiseNameExistsQuery(trimmedName));
            if (nameConflict) {
                return fail(409, `Franchise name already exists. (${trimmedName})`);
            }
            const { description, desc } = normalizeDescriptionFields({
                description: rec.description,
                desc: rec.desc,
            });
            toInsert.push({
                name: trimmedName,
                state_id: hierarchy.stateOid,
                state_name: hierarchy.state.name,
                city_id: hierarchy.cityOid,
                city_name: hierarchy.city.name,
                area_id: hierarchy.area_ids,
                area_name: hierarchy.area_names,
                admin_id: pAdmin.oid,
                admin_name: adminCtx.admin_name,
                description,
                desc,
                desc2: rec.desc2 !== undefined && rec.desc2 !== null ? String(rec.desc2) : null,
                contact:
                    rec.contact !== undefined && rec.contact !== null
                        ? String(rec.contact).trim()
                        : '',
                is_active: rec.is_active !== undefined ? rec.is_active : true,
            });
        }

        const seen = new Set();
        for (const r of toInsert) {
            const k = r.name.toLowerCase();
            if (seen.has(k)) {
                return fail(409, 'Duplicate franchise names in import file.');
            }
            seen.add(k);
        }

        const result = await Franchise.insertMany(toInsert, { ordered: false });
        return ok(200, {
            message: `${result.length} records added successfully!`,
            records: result,
        });
    } catch (error) {
        console.log('importFranchises', error.message);
        return fail(500, 'Internal server error.', { error: error.message });
    }
};

const listFranchisesForDropdown = async (query, userId) => {
    try {
        const filter = {
            deleted_at: null,
            is_active: true,
        };

        if (userId) {
            const scope = await loadFranchiseCallerScope(userId);
            if (!scope) {
                return fail(403, 'Access denied.');
            }
            if (scope.isFranchiseStaff) {
                if (!scope.franchiseOid) {
                    return fail(403, 'Your account is not linked to a franchise.');
                }
                filter._id = scope.franchiseOid;
                const sort = { name: 1 };
                const projection = { _id: 1, name: 1 };
                const { data: rows } = await applyDropDownFilter(Franchise, filter, sort, projection);
                return ok(200, {
                    message: 'Franchise list fetched successfully.',
                    records: rows,
                });
            }
            if (!scope.isSuper) {
                return fail(403, 'Access denied.');
            }
        }

        const fullListRaw = query.full_list ?? query.fullList;
        const fullList =
            fullListRaw === true ||
            fullListRaw === 1 ||
            String(fullListRaw ?? '')
                .trim()
                .toLowerCase() === 'true' ||
            String(fullListRaw ?? '').trim() === '1';

        if (!fullList) {
            const adminFranchiseOwners = {
                deleted_at: null,
                type: 1,
                franchise_id: { $exists: true, $ne: null },
            };
            const forUserRaw = query.for_user_id ?? query.forUserId;
            if (forUserRaw !== undefined && forUserRaw !== null && String(forUserRaw).trim() !== '') {
                const parsedUser = parseObjectId(forUserRaw, 'for_user_id');
                if (!parsedUser.ok) {
                    return fail(400, parsedUser.message);
                }
                adminFranchiseOwners._id = { $ne: parsedUser.oid };
            }

            const assignedFranchiseIds = await User.distinct('franchise_id', adminFranchiseOwners);
            const blockedIds = assignedFranchiseIds.filter((id) => id != null);
            if (blockedIds.length > 0) {
                filter._id = { $nin: blockedIds };
            }
        }

        const sort = { name: 1 };
        const projection = { _id: 1, name: 1 };
        const { data: rows } = await applyDropDownFilter(Franchise, filter, sort, projection);
        return ok(200, {
            message: 'Franchise list fetched successfully.',
            records: rows,
        });
    } catch (err) {
        console.log('listFranchisesForDropdown', err.message);
        return fail(500, 'Internal server error.');
    }
};

const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_CUSTOMER = 4;

const USER_LIST_SELECT =
    'name email phone_number user_id profile_url type franchise_id is_active is_blocked city_id state_id created_at';

/** Matches user_controller getAll shape for type-4 address rows; includes user_id so rows can be grouped by customer. */
const CUSTOMER_ADDRESS_LIST_SELECT =
    '_id user_id contact_name contact_number address landmark area area_id state_id city_id state city pincode address_status created_at updated_at';

const isCatalogCategoryActive = (doc) =>
    Boolean(
        doc &&
            doc.is_active === true &&
            String(doc.approval_status || '').toLowerCase() === 'approve'
    );

const isCatalogServiceActive = (doc) =>
    Boolean(
        doc &&
            doc.is_active === true &&
            String(doc.approval_status || '').toLowerCase() === 'approve'
    );

/** Area ObjectIds linked on franchise.area_id (same shape as area_service / count_controller). */
const collectFranchiseAreaIds = (franchiseDocs) => {
    const seen = new Set();
    const oids = [];
    for (const fr of franchiseDocs || []) {
        if (!fr || fr.area_id == null) continue;
        const arr = Array.isArray(fr.area_id) ? fr.area_id : [fr.area_id];
        for (const item of arr) {
            let oid = null;
            if (item instanceof mongoose.Types.ObjectId) {
                oid = item;
            } else if (item && typeof item === 'object' && item._id) {
                oid = item._id;
            } else if (typeof item === 'string' && /^[a-fA-F0-9]{24}$/i.test(item.trim())) {
                oid = new mongoose.Types.ObjectId(item.trim());
            }
            if (!oid) continue;
            const k = oid.toString();
            if (seen.has(k)) continue;
            seen.add(k);
            oids.push(oid);
        }
    }
    return oids;
};

/**
 * Type-4 users with at least one non-deleted Address whose pincode matches a pincode
 * on one of the franchise's linked areas (area.pincodes).
 */
const fetchCustomersMatchingFranchiseAreaPincodes = async (franchiseLean) => {
    const areaIds = collectFranchiseAreaIds([franchiseLean]);
    if (areaIds.length === 0) return [];

    const areas = await Area.find({
        _id: { $in: areaIds },
        deleted_at: null,
    })
        .select('pincodes')
        .lean();

    const allowedPins = [];
    const pinSeen = new Set();
    for (const a of areas) {
        for (const p of a.pincodes || []) {
            const t = String(p).trim();
            if (!t || pinSeen.has(t)) continue;
            pinSeen.add(t);
            allowedPins.push(t);
        }
    }
    if (allowedPins.length === 0) return [];

    const rows = await Address.aggregate([
        {
            $match: {
                deleted_at: null,
                user_id: { $exists: true, $ne: null },
            },
        },
        {
            $addFields: {
                pinNorm: {
                    $trim: {
                        input: {
                            $toString: { $ifNull: ['$pincode', ''] },
                        },
                    },
                },
            },
        },
        { $match: { pinNorm: { $in: allowedPins } } },
        { $group: { _id: '$user_id' } },
    ]);

    const userIds = rows.map((r) => r._id).filter(Boolean);
    if (userIds.length === 0) return [];

    const customers = await User.find({
        _id: { $in: userIds },
        type: USER_TYPE_CUSTOMER,
        deleted_at: null,
    })
        .select(USER_LIST_SELECT)
        .sort({ name: 1 })
        .lean();

    if (customers.length === 0) return [];

    const allAddresses = await Address.find({
        user_id: { $in: userIds },
        deleted_at: null,
    })
        .sort({ created_at: 1 })
        .select(CUSTOMER_ADDRESS_LIST_SELECT)
        .lean();

    const addressesByUserId = new Map();
    for (const addr of allAddresses) {
        const uid = addr.user_id && addr.user_id.toString();
        if (!uid) continue;
        if (!addressesByUserId.has(uid)) addressesByUserId.set(uid, []);
        addressesByUserId.get(uid).push(addr);
    }

    return customers.map((c) => ({
        ...c,
        addresses: addressesByUserId.get(c._id.toString()) || [],
    }));
};

/** Global catalog fields for franchise related-catalog partner hydration. */
const RELATED_CATALOG_SERVICE_SELECT =
    'service_id name desc image_url category_id is_active is_request tax commission payment_type minimum_deposit approval_status rejection_reason requested_by created_at updated_at';

const RELATED_CATALOG_CATEGORY_SELECT =
    'category_id name desc image_url is_active is_request approval_status rejection_reason requested_by created_at updated_at';

const getFranchiseRelatedCatalog = async (franchiseIdRaw) => {
    try {
        const parsed = parseObjectId(franchiseIdRaw, 'franchise_id');
        if (!parsed.ok) return fail(400, parsed.message);

        const franchise = await Franchise.findOne({
            _id: parsed.oid,
            deleted_at: null,
        })
            .select('_id name area_id')
            .lean();
        if (!franchise) return fail(404, 'Franchise not found.');

        const franchiseEffective = await resolveFranchiseEffectiveCatalog(parsed.oid);
        if (!franchiseEffective.ok) return fail(franchiseEffective.status, franchiseEffective.message);

        const [partners, employees, customers] = await Promise.all([
            User.find({
                franchise_id: parsed.oid,
                type: USER_TYPE_PARTNER,
                deleted_at: null,
            })
                .select(USER_LIST_SELECT)
                .sort({ name: 1 })
                .lean(),
            User.find({
                franchise_id: parsed.oid,
                type: USER_TYPE_EMPLOYEE,
                deleted_at: null,
            })
                .select(USER_LIST_SELECT)
                .sort({ name: 1 })
                .lean(),
            fetchCustomersMatchingFranchiseAreaPincodes(franchise),
        ]);

        const partnerIds = partners.map((p) => p._id);

        let psRows = [];
        let pcRows = [];
        if (partnerIds.length > 0) {
            [psRows, pcRows] = await Promise.all([
                PartnerService.find({
                    partner_id: { $in: partnerIds },
                    deleted_at: null,
                })
                    .select(
                        'partner_id category_id service_id is_accept_request description price is_active created_at updated_at'
                    )
                    .lean(),
                PartnerCategory.find({
                    partner_id: { $in: partnerIds },
                    deleted_at: null,
                })
                    .select('partner_id category_id services is_active created_at updated_at')
                    .lean(),
            ]);
        }

        /** partnerId -> categoryId -> partner local is_enabled */
        const partnerCategoryEnabledByPartner = new Map();
        for (const row of pcRows) {
            const pid = row.partner_id.toString();
            const cid = row.category_id?.toString();
            if (!cid) continue;
            if (!partnerCategoryEnabledByPartner.has(pid)) {
                partnerCategoryEnabledByPartner.set(pid, new Map());
            }
            partnerCategoryEnabledByPartner.get(pid).set(cid, Boolean(row.is_active));
        }

        const partnerServiceIds = [
            ...new Set(psRows.map((r) => r.service_id?.toString()).filter(Boolean)),
        ];
        const partnerCategoryIds = [
            ...new Set(pcRows.map((r) => r.category_id?.toString()).filter(Boolean)),
        ];

        const [serviceRows, categoryRows] = await Promise.all([
            partnerServiceIds.length === 0
                ? []
                : Service.find({
                      _id: { $in: partnerServiceIds },
                      deleted_at: null,
                  })
                      .select(RELATED_CATALOG_SERVICE_SELECT)
                      .lean(),
            partnerCategoryIds.length === 0
                ? []
                : Category.find({
                      _id: { $in: partnerCategoryIds },
                      deleted_at: null,
                  })
                      .select(RELATED_CATALOG_CATEGORY_SELECT)
                      .lean(),
        ]);

        const svcById = new Map(serviceRows.map((s) => [s._id.toString(), s]));
        const catById = new Map(categoryRows.map((c) => [c._id.toString(), c]));

        const partnerServiceMap = new Map();
        for (const row of psRows) {
            const svcKey = row.service_id?.toString();
            const catKey = row.category_id?.toString();
            const svc = svcById.get(svcKey);
            const cat = catKey ? catById.get(catKey) : null;
            if (!svc) continue;

            const pid = row.partner_id.toString();
            const partnerEnabled = Boolean(row.is_active);
            const partnerCategoryEnabled = catKey
                ? partnerCategoryEnabledByPartner.get(pid)?.get(catKey) === true
                : false;
            const globalServiceActive = isGlobalCatalogRowActive(svc);
            const globalCategoryActive = cat ? isGlobalCatalogRowActive(cat) : false;
            const franchiseServiceEnabled =
                franchiseEffective.serviceEnabled.get(svcKey) === true;
            const franchiseCategoryEnabled = catKey
                ? franchiseEffective.categoryEnabled.get(catKey) === true
                : false;

            const effectiveActive = computeServiceEffectiveActive({
                globalCategoryActive,
                globalServiceActive,
                franchiseCategoryEnabled,
                franchiseServiceEnabled,
                partnerCategoryEnabled,
                partnerServiceEnabled: partnerEnabled,
            });

            const item = {
                _id: row._id,
                service_id: row.service_id,
                category_id: row.category_id,
                is_accept_request: Boolean(row.is_accept_request),
                description: row.description ?? '',
                price: row.price ?? 0,
                /** Partner local preference (is_enabled). */
                is_active: partnerEnabled,
                partner_enabled: partnerEnabled,
                global_active: globalServiceActive && globalCategoryActive,
                franchise_enabled: franchiseServiceEnabled && franchiseCategoryEnabled,
                effective_active: effectiveActive,
                created_at: row.created_at ?? null,
                updated_at: row.updated_at ?? null,
                service: svc,
            };

            if (effectiveActive) {
                if (!partnerServiceMap.has(pid)) partnerServiceMap.set(pid, []);
                partnerServiceMap.get(pid).push(item);
            }
        }

        const partnerCategoryMap = new Map();
        for (const row of pcRows) {
            const catKey = row.category_id?.toString();
            const cat = catById.get(catKey);
            if (!cat) continue;
            const pid = row.partner_id.toString();
            const partnerEnabled = Boolean(row.is_active);
            const globalCategoryActive = isGlobalCatalogRowActive(cat);
            const franchiseCategoryEnabled =
                franchiseEffective.categoryEnabled.get(catKey) === true;
            const effectiveActive = computeCategoryEffectiveActive({
                globalActive: globalCategoryActive,
                franchiseEnabled: franchiseCategoryEnabled,
                partnerEnabled,
            });

            const item = {
                _id: row._id,
                category_id: row.category_id,
                services: Array.isArray(row.services) ? row.services : [],
                is_active: partnerEnabled,
                partner_enabled: partnerEnabled,
                global_active: globalCategoryActive,
                franchise_enabled: franchiseCategoryEnabled,
                effective_active: effectiveActive,
                created_at: row.created_at ?? null,
                updated_at: row.updated_at ?? null,
                category: cat,
            };

            if (effectiveActive) {
                if (!partnerCategoryMap.has(pid)) partnerCategoryMap.set(pid, []);
                partnerCategoryMap.get(pid).push(item);
            }
        }

        for (const [, list] of partnerServiceMap) {
            list.sort((a, b) =>
                String(a.service?.name || '').localeCompare(String(b.service?.name || ''), 'en', {
                    sensitivity: 'base',
                })
            );
        }
        for (const [, list] of partnerCategoryMap) {
            list.sort((a, b) =>
                String(a.category?.name || '').localeCompare(String(b.category?.name || ''), 'en', {
                    sensitivity: 'base',
                })
            );
        }

        const partnersWithServices = partners.map((p) => {
            const key = p._id.toString();
            return {
                ...p,
                /** Effectively available offerings (global ∩ franchise ∩ partner). */
                active_services_providing: partnerServiceMap.get(key) || [],
                active_categories_providing: partnerCategoryMap.get(key) || [],
            };
        });

        return ok(200, {
            message: 'Franchise catalog fetched successfully.',
            record: {
                franchise: franchise,
                partners: partnersWithServices,
                employees,
                customers,
            },
        });
    } catch (err) {
        console.error('getFranchiseRelatedCatalog', err.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    listFranchises,
    createFranchise,
    updateFranchise,
    getFranchiseById,
    softDeleteFranchise,
    importFranchises,
    listFranchisesForDropdown,
    getFranchiseRelatedCatalog,
};
