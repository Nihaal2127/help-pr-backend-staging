const mongoose = require('mongoose');
const State = require('../models/state');
const City = require('../models/city');
const Area = require('../models/area');

/**
 * Validates state/city/area/pincode chain and returns denormalized location fields.
 * Returns { ok: true, fields } or { ok: false, status, message }.
 */
const resolveLocationFields = async ({ state_id, city_id, area_id, pincode }) => {
  if (!mongoose.Types.ObjectId.isValid(String(state_id))) {
    return { ok: false, status: 400, message: 'Invalid state id.' };
  }
  if (!mongoose.Types.ObjectId.isValid(String(city_id))) {
    return { ok: false, status: 400, message: 'Invalid city id.' };
  }
  if (!mongoose.Types.ObjectId.isValid(String(area_id))) {
    return { ok: false, status: 400, message: 'Invalid area id.' };
  }

  const stateOid = new mongoose.Types.ObjectId(String(state_id));
  const cityOid = new mongoose.Types.ObjectId(String(city_id));
  const areaOid = new mongoose.Types.ObjectId(String(area_id));
  const pincodeValue = String(pincode).trim();

  const state = await State.findOne({ _id: stateOid, deleted_at: null }).lean();
  if (!state) return { ok: false, status: 400, message: 'State not found.' };
  if (state.is_active === false) return { ok: false, status: 400, message: 'State is not active.' };

  const city = await City.findOne({ _id: cityOid, deleted_at: null }).lean();
  if (!city) return { ok: false, status: 400, message: 'City not found.' };
  if (String(city.state_id) !== String(stateOid)) {
    return { ok: false, status: 400, message: 'City does not belong to the selected state.' };
  }
  if (city.is_active === false) return { ok: false, status: 400, message: 'City is not active.' };

  const area = await Area.findOne({ _id: areaOid, deleted_at: null }).lean();
  if (!area) return { ok: false, status: 400, message: 'Area not found.' };
  if (String(area.city_id) !== String(cityOid)) {
    return { ok: false, status: 400, message: 'Area does not belong to the selected city.' };
  }
  if (String(area.state_id) !== String(stateOid)) {
    return { ok: false, status: 400, message: 'Area does not belong to the selected state.' };
  }
  if (area.is_active === false) return { ok: false, status: 400, message: 'Area is not active.' };

  const areaPincodes = Array.isArray(area.pincodes)
    ? area.pincodes.map((p) => String(p).trim())
    : [];
  if (!areaPincodes.includes(pincodeValue)) {
    return {
      ok: false,
      status: 400,
      message: 'Pincode must be selected from the list for the chosen area.',
    };
  }

  return {
    ok: true,
    fields: {
      state_id: stateOid,
      city_id: cityOid,
      area_id: areaOid,
      state: state.name,
      city: city.name,
      area: area.name,
      pincode: pincodeValue,
    },
  };
};

module.exports = {
  resolveLocationFields,
};
