const mongoose = require('mongoose');
const State = require('../../../models/state');
const City = require('../../../models/city');
const Area = require('../../../models/area');
const Franchise = require('../../../models/franchise');
const { applyDropDownFilter } = require('../../../utils/pagination');

const { fail, ok } = require('../../../utils/mobile_service_result');

const collectObjectIdsFromField = (franchiseDocs, fieldName) => {
  const seen = new Set();
  const oids = [];
  for (const fr of franchiseDocs || []) {
    const value = fr[fieldName];
    if (fieldName === 'area_id') {
      const arr = Array.isArray(value) ? value : [];
      for (const raw of arr) {
        if (!raw) continue;
        const s = raw instanceof mongoose.Types.ObjectId ? raw.toString() : String(raw).trim();
        if (s && /^[a-fA-F0-9]{24}$/.test(s) && !seen.has(s)) {
          seen.add(s);
          oids.push(new mongoose.Types.ObjectId(s));
        }
      }
      continue;
    }
    if (!value) continue;
    const s = value instanceof mongoose.Types.ObjectId ? value.toString() : String(value).trim();
    if (s && /^[a-fA-F0-9]{24}$/.test(s) && !seen.has(s)) {
      seen.add(s);
      oids.push(new mongoose.Types.ObjectId(s));
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

const normalizePincodes = (pincodes) => {
  if (!pincodes || !Array.isArray(pincodes)) return [];
  return [...new Set(pincodes.map((p) => String(p).trim()).filter(Boolean))];
};

const listStatesForPartner = async () => {
  try {
    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };

    const { data: states } = await applyDropDownFilter(State, filter, sort);

    return ok(200, {
      message: 'State list fetched successfully.',
      data: states,
    });
  } catch (err) {
    console.error('listStatesForPartner', err.message);
    return fail(500, 'Internal server error.');
  }
};

/** Only cities that have at least one active franchise (scoped by state_id when provided). */
const listCitiesForPartner = async ({ stateOids = [] } = {}) => {
  try {
    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };

    const franchiseFilter = {
      deleted_at: null,
      is_active: true,
    };

    if (stateOids.length > 0) {
      filter.state_id = { $in: stateOids };
      franchiseFilter.state_id = filter.state_id;
    }

    const franchises = await Franchise.find(franchiseFilter).select('city_id').lean();
    const coveredCityIds = collectObjectIdsFromField(franchises, 'city_id');

    if (coveredCityIds.length === 0) {
      return ok(200, {
        message: 'City list fetched successfully.',
        data: [],
      });
    }

    filter._id = { $in: coveredCityIds };

    const { data: cities } = await applyDropDownFilter(City, filter, sort);

    return ok(200, {
      message: 'City list fetched successfully.',
      data: cities,
    });
  } catch (err) {
    console.error('listCitiesForPartner', err.message);
    return fail(500, 'Internal server error.');
  }
};

/** Only areas linked on an active franchise (scoped by city_id / state_id when provided). */
const listAreasForPartner = async ({ cityOids = [], stateOids = [] } = {}) => {
  try {
    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };

    if (cityOids.length > 0) {
      filter.city_id = { $in: cityOids };
    }

    if (stateOids.length > 0) {
      filter.state_id = { $in: stateOids };
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
    const coveredAreaIds = collectObjectIdsFromField(franchises, 'area_id');

    if (coveredAreaIds.length === 0) {
      return ok(200, {
        message: 'Area list fetched successfully.',
        data: [],
      });
    }

    filter._id = { $in: coveredAreaIds };

    const { data: areas } = await applyDropDownFilter(Area, filter, sort);
    const areasWithCity = await attachCityNames(areas);

    return ok(200, {
      message: 'Area list fetched successfully.',
      data: areasWithCity,
    });
  } catch (err) {
    console.error('listAreasForPartner', err.message);
    return fail(500, 'Internal server error.');
  }
};

const listPincodesForPartner = async ({ areaOids = [] } = {}) => {
  try {
    const areas = await Area.find({
      _id: { $in: areaOids },
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

    const pincodes = [...pincodeSet].sort().map((pincode) => ({ pincode }));

    return ok(200, {
      message: 'Pincode list fetched successfully.',
      data: pincodes,
    });
  } catch (err) {
    console.error('listPincodesForPartner', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listStatesForPartner,
  listCitiesForPartner,
  listAreasForPartner,
  listPincodesForPartner,
};
