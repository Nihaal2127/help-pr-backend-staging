const mongoose = require('mongoose');
const Franchise = require('../models/franchise');
const Category = require('../models/category');
const Service = require('../models/service');
const State = require('../models/state');
const City = require('../models/city');
const Area = require('../models/area');
const User = require('../models/user');
const FranchiseCategory = require('../models/franchise_category');
const FranchiseService = require('../models/franchise_service');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');
const { sanitizeInput } = require('../validator/search_keyword_validator');

const parseObjectId = (raw, fieldName = 'id') => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!s || !/^[a-fA-F0-9]{24}$/.test(s)) {
        return {
            ok: false,
            message: `${fieldName} must be a valid MongoDB ObjectId (24 hex characters).`,
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
        return { ok: false, message: `${fieldName} must be an array.` };
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
                filter.name = { $regex: new RegExp(sanitizeInput(s), 'i') };
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

        const existing = await Franchise.findOne({
            name,
            city_id: hierarchy.cityOid,
            deleted_at: null,
        });
        if (existing) {
            return fail(409, 'Franchise name already exists for this city.');
        }

        const doc = new Franchise({
            name,
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
        try {
            await FranchiseCategory.create({
                franchise_id: saved._id,
                categories_list: categoryOids,
            });
            await FranchiseService.create({
                franchise_id: saved._id,
                services_list: serviceOids,
            });
        } catch (mapError) {
            await Franchise.findByIdAndDelete(saved._id);
            console.error('createFranchise.mapping', mapError.message);
            return fail(500, 'Failed to create franchise category/service mapping records.');
        }
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
            const existing = await Franchise.findOne({
                name: body.name,
                city_id: hierarchy.cityOid,
                deleted_at: null,
                _id: { $ne: id },
            });
            if (existing) return fail(409, 'Franchise name already exists for this city.');
            franchise.name = body.name;
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
                return fail(400, 'Each record must include name, state_id, city_id, and admin_id.');
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
                return fail(400, `Admin user not found for franchise: ${rec.name}`);
            }
            const { description, desc } = normalizeDescriptionFields({
                description: rec.description,
                desc: rec.desc,
            });
            toInsert.push({
                name: rec.name,
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

        const key = (r) => `${r.city_id.toString()}:${r.name}`;
        const seen = new Set();
        for (const r of toInsert) {
            const k = key(r);
            if (seen.has(k)) {
                return fail(409, 'Duplicate city/name combinations in import file.');
            }
            seen.add(k);
        }

        const existing = await Franchise.find({
            deleted_at: null,
            $or: toInsert.map((r) => ({ name: r.name, city_id: r.city_id })),
        }).select('name city_id');

        if (existing.length > 0) {
            const lines = existing.map((e) => `${e.name} (city ${e.city_id})`).join('\n');
            return fail(409, `Duplicate records found.\n${lines}`);
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

const listFranchisesForDropdown = async (query) => {
    try {
        const filter = {
            deleted_at: null,
            is_active: true,
        };
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

module.exports = {
    listFranchises,
    createFranchise,
    updateFranchise,
    getFranchiseById,
    softDeleteFranchise,
    importFranchises,
    listFranchisesForDropdown,
};
