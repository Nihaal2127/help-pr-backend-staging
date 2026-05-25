const mongoose = require('mongoose');
const { fieldLabel } = require('../utils/field_labels');
const Area = require('../models/area');
const City = require('../models/city');
const User = require('../models/user');
const Franchise = require('../models/franchise');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');
const {
    pickFranchiseIdRaw,
    parseFranchiseObjectId,
    assertFranchiseAccess,
} = require('../utils/franchise_access');

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const areaNameExistsInCity = (trimmedName, cityObjectId) => ({
    deleted_at: null,
    city_id: cityObjectId,
    name: new RegExp(`^${escapeRegExp(trimmedName)}$`, 'i'),
});

const normalizePincodes = (pincodes) => {
    if (!pincodes || !Array.isArray(pincodes)) return [];
    return [...new Set(pincodes.map((p) => String(p).trim()).filter(Boolean))];
};

/** Rejects values like "10" — MongoDB _id must be 24 hex chars. */
const parseObjectId = (raw, fieldName = 'id') => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!s || !/^[a-fA-F0-9]{24}$/.test(s)) {
        return {
            ok: false,
            message: `${fieldLabel(fieldName)} must be a valid MongoDB ObjectId (24 hex characters). Use the city document _id from GET /api/city/getAll — not a row number or arbitrary number.`,
        };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const loadCityContext = async (cityObjectId) => {
    const city = await City.findOne({ _id: cityObjectId, deleted_at: null });
    if (!city) return null;
    return {
        city,
        state_id: city.state_id,
        state_name: city.state_name,
    };
};

const attachCityNames = async (areaDocs) => {
    const list = Array.isArray(areaDocs) ? areaDocs : [areaDocs];
    if (list.length === 0) return list;
    const ids = [...new Set(list.map((a) => a.city_id && a.city_id.toString()).filter(Boolean))].map(
        (id) => new mongoose.Types.ObjectId(id)
    );
    const cities = await City.find({ _id: { $in: ids }, deleted_at: null })
        .select('name')
        .lean();
    const cityMap = new Map(cities.map((c) => [c._id.toString(), c.name]));
    return list.map((a) => {
        const o = a.toObject ? a.toObject() : { ...a };
        o.city_name = cityMap.get(o.city_id.toString()) || null;
        return o;
    });
};

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

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

const getMyFranchiseAreaIds = async (userId) => {
    const caller = await User.findOne({ _id: userId, deleted_at: null }).select('type franchise_id').lean();
    if (!caller) return [];

    const callerType = Number(caller.type);
    let franchiseDocs = [];
    if (callerType === 1) {
        if (caller.franchise_id) {
            const one = await Franchise.findOne({
                _id: caller.franchise_id,
                deleted_at: null,
            })
                .select('_id area_id')
                .lean();
            franchiseDocs = one ? [one] : [];
        } else {
            franchiseDocs = await Franchise.find({
                deleted_at: null,
                admin_id: userId,
            })
                .select('_id area_id')
                .lean();
        }
    } else if (caller.franchise_id) {
        const one = await Franchise.findOne({
            _id: caller.franchise_id,
            deleted_at: null,
        })
            .select('_id area_id')
            .lean();
        if (one) franchiseDocs = [one];
    }

    return collectFranchiseAreaIds(franchiseDocs);
};

const listAreas = async (query, authUser) => {
    try {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const is_active =
            query.is_active !== undefined ? parseBoolean(query.is_active) : null;
        const skip = (page - 1) * limit;

        const filter = {
            deleted_at: null,
            ...(query.is_active !== undefined && { is_active }),
        };

        const typeRaw = (query.type ?? '').toString().trim().toLowerCase();
        const isMyFranchiseList = typeRaw === 'my-franchise' || typeRaw === 'my_franchise';
        if (isMyFranchiseList) {
            if (!authUser || authUser.id == null) {
                return fail(401, 'Unauthorized.');
            }
            const areaIds = await getMyFranchiseAreaIds(authUser.id);
            filter._id = { $in: areaIds };
        } else {
            const franchiseIdRaw = pickFranchiseIdRaw(query);
            if (franchiseIdRaw) {
                const parsedFranchise = parseFranchiseObjectId(franchiseIdRaw, 'franchise_id');
                if (!parsedFranchise.ok) return fail(400, parsedFranchise.message);

                if (!authUser || authUser.id == null) {
                    return fail(401, 'Unauthorized.');
                }
                const access = await assertFranchiseAccess(authUser, parsedFranchise.oid);
                if (!access.ok) {
                    return fail(access.status, access.message);
                }

                const franchise = await Franchise.findOne({
                    _id: parsedFranchise.oid,
                    deleted_at: null,
                })
                    .select('area_id')
                    .lean();
                if (!franchise) return fail(404, 'Franchise not found.');
                const areaIds = collectFranchiseAreaIds([franchise]);
                filter._id = { $in: areaIds };
            }
        }
        const areaNameSearch = query.areaname || query.name;
        const trimmedAreaSearch =
            areaNameSearch !== undefined && areaNameSearch !== null
                ? String(areaNameSearch).trim()
                : '';
        const unifiedSearchPattern =
            trimmedAreaSearch.length > 0 ? escapeRegExp(trimmedAreaSearch) : null;

        if (query.pincode) {
            const pc = String(query.pincode).trim();
            filter.pincodes = pc;
        }

        if (query.state) {
            filter.state_name = { $regex: new RegExp(String(query.state).trim(), 'i') };
        }

        if (query.city_id) {
            let cityIds = query.city_id;
            if (!Array.isArray(cityIds)) {
                cityIds = String(cityIds).split(',');
            }
            const oids = [];
            for (const raw of cityIds) {
                const id = String(raw).trim();
                if (!id) continue;
                const p = parseObjectId(id, 'city_id');
                if (!p.ok) return fail(400, p.message);
                oids.push(p.oid);
            }
            if (oids.length === 0) {
                return fail(400, 'Provide at least one valid city.');
            }
            filter.city_id = { $in: oids };
        }

        const sortOrderRaw = (query.sort_order || query.sortOrder || query.order || 'desc')
            .toString()
            .toLowerCase();
        const sortDirection =
            sortOrderRaw === 'asc' || sortOrderRaw === '1' ? 1 : -1;
        const sortByRaw = (query.sort_by || query.sortBy || '').toString().toLowerCase();
        const sortFieldMap = {
            areaname: 'name',
            area: 'name',
            city: 'city_name',
            state: 'state_name',
        };
        const mappedSortField = sortFieldMap[sortByRaw];
        const sort = mappedSortField
            ? { [mappedSortField]: sortDirection, _id: 1 }
            : { created_at: query.sort !== undefined ? parseInt(query.sort, 10) : -1 };

        const cityMatchStage = query.city
            ? {
                  'city_doc.name': {
                      $regex: new RegExp(String(query.city).trim(), 'i'),
                  },
              }
            : null;

        const unifiedSearchStage =
            unifiedSearchPattern !== null
                ? {
                      $match: {
                          $or: [
                              { name: { $regex: unifiedSearchPattern, $options: 'i' } },
                              { state_name: { $regex: unifiedSearchPattern, $options: 'i' } },
                              { city_name: { $regex: unifiedSearchPattern, $options: 'i' } },
                              { pincodes: { $regex: unifiedSearchPattern, $options: 'i' } },
                          ],
                      },
                  }
                : null;

        const pipeline = [
            { $match: filter },
            {
                $lookup: {
                    from: 'cities',
                    localField: 'city_id',
                    foreignField: '_id',
                    as: 'city_doc',
                },
            },
            {
                $unwind: {
                    path: '$city_doc',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $addFields: {
                    city_name: '$city_doc.name',
                },
            },
            ...(unifiedSearchStage ? [unifiedSearchStage] : []),
            ...(cityMatchStage ? [{ $match: cityMatchStage }] : []),
            { $sort: sort },
            {
                $facet: {
                    data: [{ $skip: skip }, { $limit: limit }, { $project: { city_doc: 0 } }],
                    totalCount: [{ $count: 'totalCount' }],
                },
            },
        ];

        const result = await Area.aggregate(pipeline);
        const areas = result[0]?.data || [];
        const totalCount = result[0]?.totalCount?.[0]?.totalCount || 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = page;
        const records = areas;

        return ok(200, {
            message: 'Area list fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage,
            records,
        });
    } catch (err) {
        console.log('listAreas', err.message);
        return fail(500, 'Internal server error.');
    }
};

const createArea = async (body) => {
    try {
        const { name, is_active, city_id, pincodes } = body;
        const pinList = normalizePincodes(pincodes);
        const trimmedName = String(name).trim();
        if (!trimmedName) {
            return fail(400, 'Area name is required.');
        }

        const parsedCity = parseObjectId(city_id, 'city_id');
        if (!parsedCity.ok) return fail(400, parsedCity.message);

        const ctx = await loadCityContext(parsedCity.oid);
        if (!ctx) return fail(404, 'City not found.');

        const existing = await Area.findOne(areaNameExistsInCity(trimmedName, ctx.city._id));
        if (existing) return fail(409, 'Area name already exists for this city.');

        const newArea = new Area({
            name: trimmedName,
            is_active,
            city_id: ctx.city._id,
            state_id: ctx.state_id,
            state_name: ctx.state_name,
            pincodes: pinList,
        });

        const saved = await newArea.save();
        const [record] = await attachCityNames([saved]);
        return ok(200, { message: 'Area created successfully.', record });
    } catch (error) {
        console.error('createArea', error.message);
        return fail(500, 'Internal server error.');
    }
};

const updateArea = async (id, body) => {
    const updateData = { ...body };
    delete updateData.state_id;
    delete updateData.state_name;

    try {
        const area = await Area.findById(id);
        if (!area) return fail(404, 'No record found');

        let targetCityId = area.city_id;
        if (body.city_id !== undefined && body.city_id !== '') {
            const parsedCity = parseObjectId(body.city_id, 'city_id');
            if (!parsedCity.ok) return fail(400, parsedCity.message);
            targetCityId = parsedCity.oid;
            const ctx = await loadCityContext(parsedCity.oid);
            if (!ctx) return fail(404, 'City not found.');
            area.state_id = ctx.state_id;
            area.state_name = ctx.state_name;
            area.city_id = ctx.city._id;
        }

        if (body.name !== undefined) {
            const trimmedName = String(body.name).trim();
            if (!trimmedName) {
                return fail(400, 'Area name is required.');
            }
            const existing = await Area.findOne({
                ...areaNameExistsInCity(trimmedName, targetCityId),
                _id: { $ne: id },
            });
            if (existing) return fail(409, 'Area name already exists for this city.');
            if (updateData.name !== undefined) updateData.name = trimmedName;
        }

        if (body.pincodes !== undefined) {
            area.pincodes = normalizePincodes(body.pincodes);
            delete updateData.pincodes;
        }

        Object.keys(updateData).forEach((key) => {
            if (key === 'pincodes') return;
            if (updateData[key] !== undefined) {
                area[key] = updateData[key];
            }
        });

        area.updated_at = new Date();
        const updatedArea = await area.save();
        const [record] = await attachCityNames([updatedArea]);

        return ok(200, { message: 'Area updated successfully', record });
    } catch (error) {
        console.error('updateArea', error.message);
        return fail(500, 'Internal server error.');
    }
};

const getAreaById = async (id) => {
    try {
        const area = await Area.findById(id);
        if (!area) return fail(404, 'No record found');

        const [record] = await attachCityNames([area]);
        return ok(200, { message: 'Area fetched successfully', record });
    } catch (error) {
        console.error('getAreaById', error);
        return fail(500, 'Internal server error.');
    }
};

const softDeleteArea = async (id) => {
    try {
        const area = await Area.findById(id);
        if (!area) return fail(404, 'No record found');
        if (area.deleted_at) return fail(400, 'Area is already deleted');

        area.deleted_at = new Date();
        await area.save();
        return ok(200, { message: 'Area deleted successfully' });
    } catch (error) {
        console.error('softDeleteArea', error);
        return fail(500, 'Internal server error.');
    }
};

const importAreas = async (records) => {
    if (!records || !Array.isArray(records)) {
        return fail(400, 'Invalid input. Expected an array of records.');
    }
    if (records.length === 0) {
        return fail(400, 'Please add records in excel sheet.');
    }

    try {
        const toInsert = [];
        for (const rec of records) {
            if (!rec.name || !rec.city_id) {
                return fail(400, 'Each record must include name and city.');
            }
            const parsedCity = parseObjectId(rec.city_id, 'city_id');
            if (!parsedCity.ok) {
                return fail(400, `${parsedCity.message} (area: ${rec.name})`);
            }
            const ctx = await loadCityContext(parsedCity.oid);
            if (!ctx) {
                return fail(400, `City not found for area: ${rec.name}`);
            }
            const pinList = normalizePincodes(rec.pincodes);
            const trimmedAreaName = String(rec.name || '').trim();
            if (!trimmedAreaName) {
                return fail(400, 'Each record must include a non-empty area name.');
            }
            toInsert.push({
                name: trimmedAreaName,
                city_id: ctx.city._id,
                is_active: rec.is_active,
                state_id: ctx.state_id,
                state_name: ctx.state_name,
                pincodes: pinList,
            });
        }

        const seenKeys = new Set();
        for (const r of toInsert) {
            const k = `${r.city_id.toString()}:${r.name.toLowerCase()}`;
            if (seenKeys.has(k)) {
                return fail(409, 'Duplicate area name for the same city in import file.');
            }
            seenKeys.add(k);
        }

        const existing = await Area.find({
            deleted_at: null,
            $or: toInsert.map((r) => ({
                city_id: r.city_id,
                name: new RegExp(`^${escapeRegExp(r.name)}$`, 'i'),
            })),
        }).select('name city_id');

        if (existing.length > 0) {
            const lines = existing.map((e) => `${e.name} (city ${e.city_id})`).join('\n');
            return fail(409, `Duplicate records found.\n${lines}`);
        }

        const result = await Area.insertMany(toInsert, { ordered: false });
        return ok(200, {
            message: `${result.length} records added successfully!`,
            records: result,
        });
    } catch (error) {
        console.log('importAreas', error.message);
        return fail(500, 'Internal server error.', { error: error.message });
    }
};

/** Area IDs already linked on a non-deleted franchise; optionally skip one franchise (e.g. edit form). */
const collectAreaIdsAssignedToOtherFranchises = async (ignoreFranchiseOid) => {
    const docs = await Franchise.find({ deleted_at: null }).select('_id area_id').lean();
    const excluded = new Set();
    for (const fr of docs) {
        if (ignoreFranchiseOid && String(fr._id) === String(ignoreFranchiseOid)) {
            continue;
        }
        const arr = Array.isArray(fr.area_id) ? fr.area_id : [];
        for (const raw of arr) {
            if (!raw) continue;
            const s = raw instanceof mongoose.Types.ObjectId ? raw.toString() : String(raw).trim();
            if (s && /^[a-fA-F0-9]{24}$/.test(s)) {
                excluded.add(s);
            }
        }
    }
    return [...excluded].map((s) => new mongoose.Types.ObjectId(s));
};

const listAreasForDropdown = async (query) => {
    try {
        const filter = {
            deleted_at: null,
            is_active: true,
        };
        const sort = { created_at: -1 };

        if (query.city_id) {
            let cityIds = query.city_id;
            if (!Array.isArray(cityIds)) {
                cityIds = cityIds.split(',');
            }
            const oids = [];
            for (const raw of cityIds) {
                const id = String(raw).trim();
                if (!id) continue;
                const p = parseObjectId(id, 'city_id');
                if (!p.ok) return fail(400, p.message);
                oids.push(p.oid);
            }
            if (oids.length === 0) {
                return fail(400, 'Provide at least one valid city.');
            }
            filter.city_id = { $in: oids };
        }

        if (query.state_id) {
            let stateIds = query.state_id;
            if (!Array.isArray(stateIds)) {
                stateIds = stateIds.split(',');
            }
            const oids = [];
            for (const raw of stateIds) {
                const id = String(raw).trim();
                if (!id) continue;
                const p = parseObjectId(id, 'state_id');
                if (!p.ok) return fail(400, p.message);
                oids.push(p.oid);
            }
            if (oids.length === 0) {
                return fail(400, 'Provide at least one valid state.');
            }
            filter.state_id = { $in: oids };
        }

        let ignoreFranchiseOid = null;
        if (
            query.franchise_id !== undefined &&
            query.franchise_id !== null &&
            String(query.franchise_id).trim() !== ''
        ) {
            const parsedFr = parseObjectId(query.franchise_id, 'franchise_id');
            if (!parsedFr.ok) return fail(400, parsedFr.message);
            ignoreFranchiseOid = parsedFr.oid;
        }
        const assignedElsewhere = await collectAreaIdsAssignedToOtherFranchises(ignoreFranchiseOid);
        if (assignedElsewhere.length > 0) {
            filter._id = { $nin: assignedElsewhere };
        }

        const { data: areas } = await applyDropDownFilter(Area, filter, sort);
        const records = await attachCityNames(areas);

        return ok(200, {
            message: 'Area list fetched successfully.',
            records,
        });
    } catch (err) {
        console.log('listAreasForDropdown', err.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    listAreas,
    createArea,
    updateArea,
    getAreaById,
    softDeleteArea,
    importAreas,
    listAreasForDropdown,
};
