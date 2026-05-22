const mongoose = require('mongoose');
const State = require('../../../models/state');
const City = require('../../../models/city');
const Area = require('../../../models/area');
const Franchise = require('../../../models/franchise');
const { applyDropDownFilter } = require('../../../utils/pagination');

const parseObjectIdList = (raw, fieldName) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: true, oids: [] };
  }
  let ids = raw;
  if (!Array.isArray(ids)) {
    ids = String(ids).split(',');
  }
  const oids = [];
  for (const item of ids) {
    const id = String(item).trim();
    if (!id) continue;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return {
        ok: false,
        status: 400,
        message: `Invalid ${fieldName} format.`,
      };
    }
    oids.push(new mongoose.Types.ObjectId(id));
  }
  if (oids.length === 0) {
    return {
      ok: false,
      status: 400,
      message: `Provide at least one valid ${fieldName}.`,
    };
  }
  return { ok: true, oids };
};

const collectAreaIdsFromFranchises = (franchiseDocs) => {
  const seen = new Set();
  const oids = [];
  for (const fr of franchiseDocs || []) {
    const arr = Array.isArray(fr.area_id) ? fr.area_id : [];
    for (const raw of arr) {
      if (!raw) continue;
      const s = raw instanceof mongoose.Types.ObjectId ? raw.toString() : String(raw).trim();
      if (s && /^[a-fA-F0-9]{24}$/.test(s) && !seen.has(s)) {
        seen.add(s);
        oids.push(new mongoose.Types.ObjectId(s));
      }
    }
  }
  return oids;
};

const attachCityNames = async (areaDocs) => {
  const list = Array.isArray(areaDocs) ? areaDocs : [areaDocs];
  if (list.length === 0) return list;
  const ids = [...new Set(list.map((a) => a.city_id && a.city_id.toString()).filter(Boolean))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  const cities = await City.find({ _id: { $in: ids }, deleted_at: null }).select('name').lean();
  const cityMap = new Map(cities.map((c) => [c._id.toString(), c.name]));
  return list.map((a) => {
    const o = a.toObject ? a.toObject() : { ...a };
    o.city_name = cityMap.get(o.city_id.toString()) || null;
    return o;
  });
};

const states = async (req, res) => {
  try {
    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };

    const { data: states } = await applyDropDownFilter(State, filter, sort);

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'State list fetched successfully.',
      records: states,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const cities = async (req, res) => {
  try {
    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };

    if (req.query.state_id) {
      let stateIds = req.query.state_id;

      if (!Array.isArray(stateIds)) {
        stateIds = stateIds.split(',');
      }

      const validStateIds = stateIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (validStateIds.length === 0) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid state id format.',
        });
      }

      filter.state_id = { $in: validStateIds };
    }

    const { data: cities } = await applyDropDownFilter(City, filter, sort);

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'City list fetched successfully.',
      records: cities,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

/** Only areas linked on an active franchise (scoped by city_id / state_id when provided). */
const areas = async (req, res) => {
  try {
    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };

    if (req.query.city_id) {
      const parsedCity = parseObjectIdList(req.query.city_id, 'city_id');
      if (!parsedCity.ok) {
        return res.status(parsedCity.status).json({
          success: false,
          status: parsedCity.status,
          message: parsedCity.message,
        });
      }
      filter.city_id = { $in: parsedCity.oids };
    }

    if (req.query.state_id) {
      const parsedState = parseObjectIdList(req.query.state_id, 'state_id');
      if (!parsedState.ok) {
        return res.status(parsedState.status).json({
          success: false,
          status: parsedState.status,
          message: parsedState.message,
        });
      }
      filter.state_id = { $in: parsedState.oids };
    }

    const franchiseFilter = {
      deleted_at: null,
      is_active: true,
    };
    if (filter.city_id) {
      franchiseFilter.city_id = filter.city_id;
    }
    if (filter.state_id) {
      franchiseFilter.state_id = filter.state_id;
    }

    const franchises = await Franchise.find(franchiseFilter).select('area_id').lean();
    const coveredAreaIds = collectAreaIdsFromFranchises(franchises);

    if (coveredAreaIds.length === 0) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'Area list fetched successfully.',
        records: [],
      });
    }

    filter._id = { $in: coveredAreaIds };

    const { data: areas } = await applyDropDownFilter(Area, filter, sort);
    const records = await attachCityNames(areas);

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Area list fetched successfully.',
      records,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const normalizePincodes = (pincodes) => {
  if (!pincodes || !Array.isArray(pincodes)) return [];
  return [...new Set(pincodes.map((p) => String(p).trim()).filter(Boolean))];
};

const pincodes = async (req, res) => {
  try {
    const { area_id: areaIdRaw } = req.query;
    if (areaIdRaw === undefined || areaIdRaw === null || String(areaIdRaw).trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'area_id is required.',
      });
    }

    let areaIds = areaIdRaw;
    if (!Array.isArray(areaIds)) {
      areaIds = String(areaIds).split(',');
    }

    const oids = [];
    for (const raw of areaIds) {
      const id = String(raw).trim();
      if (!id) continue;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid area id format.',
        });
      }
      oids.push(new mongoose.Types.ObjectId(id));
    }

    if (oids.length === 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Provide at least one valid area_id.',
      });
    }

    const areas = await Area.find({
      _id: { $in: oids },
      deleted_at: null,
      is_active: true,
    })
      .select('pincodes')
      .lean();

    const pincodeSet = new Set();
    for (const area of areas) {
      for (const pincode of normalizePincodes(area.pincodes)) {
        pincodeSet.add(pincode);
      }
    }

    const records = [...pincodeSet].sort().map((pincode) => ({ pincode }));

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Pincode list fetched successfully.',
      records,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  states,
  cities,
  areas,
  pincodes,
};
