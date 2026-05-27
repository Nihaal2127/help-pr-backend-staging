const mongoose = require('mongoose');
const { fieldLabel } = require('../../../utils/field_labels');

const ADDRESS_FIELDS = ['state_id', 'city_id', 'area_id', 'pincode', 'address'];

/** Pincode dropdown items from GET /api/mobile/pincodes return { pincode: "560001" }. */
const normalizePincodeDropdown = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (value.pincode !== undefined && value.pincode !== null) {
      return String(value.pincode).trim();
    }
  }
  return String(value).trim();
};

const normalizeAddressDropdownFields = (req, _res, next) => {
  if (req.body.pincode !== undefined) {
    req.body.pincode = normalizePincodeDropdown(req.body.pincode);
  }
  next();
};

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const requireNonEmptyString = (value, fieldName, res) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    sendError(res, 400, `${fieldLabel(fieldName)} is required.`);
    return false;
  }
  return true;
};

const requireObjectId = (value, fieldName, res) => {
  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    sendError(res, 400, `Invalid ${fieldLabel(fieldName)} format.`);
    return false;
  }
  return true;
};

const validateCreateAddress = (req, res, next) => {
  const { state_id, city_id, area_id, pincode, address } = req.body;

  for (const field of ADDRESS_FIELDS) {
    const value = { state_id, city_id, area_id, pincode, address }[field];
    if (!requireNonEmptyString(value, field, res)) {
      return;
    }
  }

  if (!requireObjectId(state_id, 'state_id', res)) return;
  if (!requireObjectId(city_id, 'city_id', res)) return;
  if (!requireObjectId(area_id, 'area_id', res)) return;

  next();
};

const validateUpdateAddress = (req, res, next) => {
  const { state_id, city_id, area_id, pincode, address } = req.body;
  const hasAny = ADDRESS_FIELDS.some((field) => req.body[field] !== undefined);

  if (!hasAny) {
    return sendError(res, 400, 'Provide at least one field to update.');
  }

  if (state_id !== undefined) {
    if (!requireNonEmptyString(state_id, 'state_id', res)) return;
    if (!requireObjectId(state_id, 'state_id', res)) return;
  }
  if (city_id !== undefined) {
    if (!requireNonEmptyString(city_id, 'city_id', res)) return;
    if (!requireObjectId(city_id, 'city_id', res)) return;
  }
  if (area_id !== undefined) {
    if (!requireNonEmptyString(area_id, 'area_id', res)) return;
    if (!requireObjectId(area_id, 'area_id', res)) return;
  }
  if (pincode !== undefined && !requireNonEmptyString(pincode, 'pincode', res)) return;
  if (address !== undefined && !requireNonEmptyString(address, 'address', res)) return;

  const locationTouched =
    state_id !== undefined ||
    city_id !== undefined ||
    area_id !== undefined ||
    pincode !== undefined;

  if (locationTouched) {
    for (const field of ['state_id', 'city_id', 'area_id', 'pincode']) {
      if (req.body[field] === undefined) {
        return sendError(
          res,
          400,
          `When updating location, ${fieldLabel('state_id')}, ${fieldLabel('city_id')}, ${fieldLabel('area_id')}, and pincode must all be sent together.`
        );
      }
    }
  }

  next();
};

const validateAddressIdParam = (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    return sendError(res, 400, `Invalid ${fieldLabel('address_id')} format.`);
  }
  next();
};

module.exports = {
  normalizeAddressDropdownFields,
  validateCreateAddress,
  validateUpdateAddress,
  validateAddressIdParam,
};
