const mongoose = require('mongoose');
const Area = require('../models/area');
const City = require('../models/city');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');

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
            message: `${fieldName} must be a valid MongoDB ObjectId (24 hex characters). Use the city document _id from GET /api/city/getAll — not a row number or arbitrary number.`,
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

const listAreas = async (query) => {
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
        const areaNameSearch = query.areaname || query.name;
        if (areaNameSearch) {
            filter.name = { $regex: new RegExp(String(areaNameSearch).trim(), 'i') };
        }
        if (query.pincode) {
            const pc = String(query.pincode).trim();
            filter.pincodes = pc;
        }

        if (query.state) {
            filter.state_name = { $regex: new RegExp(String(query.state).trim(), 'i') };
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

        const parsedCity = parseObjectId(city_id, 'city_id');
        if (!parsedCity.ok) return fail(400, parsedCity.message);

        const ctx = await loadCityContext(parsedCity.oid);
        if (!ctx) return fail(404, 'City not found.');

        const existing = await Area.findOne({
            name,
            city_id: ctx.city._id,
            deleted_at: null,
        });
        if (existing) return fail(409, 'Area name already exists for this city.');

        const newArea = new Area({
            name,
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

        if (body.name) {
            const existing = await Area.findOne({
                name: body.name,
                city_id: targetCityId,
                deleted_at: null,
                _id: { $ne: id },
            });
            if (existing) return fail(409, 'Area name already exists for this city.');
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
                return fail(400, 'Each record must include name and city_id.');
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
            toInsert.push({
                name: rec.name,
                city_id: ctx.city._id,
                is_active: rec.is_active,
                state_id: ctx.state_id,
                state_name: ctx.state_name,
                pincodes: pinList,
            });
        }

        const keys = toInsert.map((r) => `${r.city_id.toString()}:${r.name}`);
        const dupInFile = new Set();
        const seen = new Set();
        for (const k of keys) {
            if (seen.has(k)) dupInFile.add(k);
            seen.add(k);
        }
        if (dupInFile.size > 0) {
            return fail(409, 'Duplicate city/name combinations in import file.');
        }

        const existing = await Area.find({
            deleted_at: null,
            $or: toInsert.map((r) => ({ name: r.name, city_id: r.city_id })),
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
                return fail(400, 'Provide at least one valid city_id.');
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
                return fail(400, 'Provide at least one valid state_id.');
            }
            filter.state_id = { $in: oids };
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
