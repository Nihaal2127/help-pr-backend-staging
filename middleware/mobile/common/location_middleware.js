const mongoose = require('mongoose');
const { fieldLabel } = require('../../../utils/field_labels');

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
        message: `Invalid ${fieldLabel(fieldName)} format.`,
      };
    }
    oids.push(new mongoose.Types.ObjectId(id));
  }
  if (oids.length === 0) {
    return {
      ok: false,
      status: 400,
      message: `Provide at least one valid ${fieldLabel(fieldName)}.`,
    };
  }
  return { ok: true, oids };
};

const sendValidationError = (res, parsed) =>
  res.status(parsed.status).json({
    success: false,
    status: parsed.status,
    message: parsed.message,
  });

/** GET /states — no query validation required. */
const validateStatesQuery = (req, res, next) => {
  req.mobileLocationQuery = {};
  next();
};

/** GET /cities — optional state_id; 400 when present but invalid. */
const validateCitiesQuery = (req, res, next) => {
  req.mobileLocationQuery = { stateOids: [] };

  if (req.query.state_id) {
    const parsed = parseObjectIdList(req.query.state_id, 'state_id');
    if (!parsed.ok) {
      return sendValidationError(res, parsed);
    }
    req.mobileLocationQuery.stateOids = parsed.oids;
  }

  next();
};

/** GET /areas — optional city_id / state_id; 400 when present but invalid. */
const validateAreasQuery = (req, res, next) => {
  req.mobileLocationQuery = { cityOids: [], stateOids: [] };

  if (req.query.city_id) {
    const parsed = parseObjectIdList(req.query.city_id, 'city_id');
    if (!parsed.ok) {
      return sendValidationError(res, parsed);
    }
    req.mobileLocationQuery.cityOids = parsed.oids;
  }

  if (req.query.state_id) {
    const parsed = parseObjectIdList(req.query.state_id, 'state_id');
    if (!parsed.ok) {
      return sendValidationError(res, parsed);
    }
    req.mobileLocationQuery.stateOids = parsed.oids;
  }

  next();
};

/** GET /pincodes — area_id required; 400 when missing or invalid. */
const validatePincodesQuery = (req, res, next) => {
  const areaIdRaw = req.query.area_id;
  if (areaIdRaw === undefined || areaIdRaw === null || String(areaIdRaw).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: `${fieldLabel('area_id')} is required.`,
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
      message: `Provide at least one valid ${fieldLabel('area_id')}.`,
    });
  }

  req.mobileLocationQuery = { areaOids: oids };
  next();
};

module.exports = {
  validateStatesQuery,
  validateCitiesQuery,
  validateAreasQuery,
  validatePincodesQuery,
};
