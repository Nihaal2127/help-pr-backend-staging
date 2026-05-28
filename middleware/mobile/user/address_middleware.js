const mongoose = require('mongoose');
const Address = require('../../../models/address');
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

const validateUpdateAddress = async (req, res, next) => {
  const { state_id, city_id, area_id, pincode, address } = req.body;

  let existingAddress = null;
  if (req.user?.id && req.params?.id && mongoose.Types.ObjectId.isValid(String(req.user.id))) {
    existingAddress = await Address.findOne({
      _id: req.params.id,
      user_id: req.user.id,
      deleted_at: null,
    })
      .select('state_id city_id area_id pincode address')
      .lean();
  }

  const finalStateId = state_id !== undefined ? state_id : existingAddress?.state_id;
  const finalCityId = city_id !== undefined ? city_id : existingAddress?.city_id;
  const finalAreaId = area_id !== undefined ? area_id : existingAddress?.area_id;
  const finalPincode = pincode !== undefined ? pincode : existingAddress?.pincode;
  const finalAddress = address !== undefined ? address : existingAddress?.address;

  for (const field of ADDRESS_FIELDS) {
    const value = {
      state_id: finalStateId,
      city_id: finalCityId,
      area_id: finalAreaId,
      pincode: finalPincode,
      address: finalAddress,
    }[field];
    if (!requireNonEmptyString(value, field, res)) {
      return;
    }
  }

  if (!requireObjectId(finalStateId, 'state_id', res)) return;
  if (!requireObjectId(finalCityId, 'city_id', res)) return;
  if (!requireObjectId(finalAreaId, 'area_id', res)) return;

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
