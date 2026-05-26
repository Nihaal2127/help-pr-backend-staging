const mongoose = require('mongoose');
const User = require('../../../models/user');
const { parseJSONField } = require('../../../utils/multipart_parser');

const USER_TYPE_PARTNER = 2;
const PARTNER_VERIFICATION_STATUS_APPROVED = 2;

const RESTRICTED_UNTIL_APPROVED_MESSAGE =
  'Catalog, services, and bank details can only be updated after your account is verified and approved.';

const OBJECT_ID_HEX_24 = /^[a-fA-F0-9]{24}$/;

const isValidIsActive = (value) =>
  value === true ||
  value === false ||
  value === 'true' ||
  value === 'false';

const assertApprovedPartner = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.user.id))) {
    res.status(401).json({
      success: false,
      status: 401,
      message: 'Invalid token.',
    });
    return false;
  }

  const partner = await User.findOne({
    _id: req.user.id,
    type: USER_TYPE_PARTNER,
    deleted_at: null,
  }).select('verification_status');

  if (!partner) {
    res.status(404).json({
      success: false,
      status: 404,
      message: 'Partner not found.',
    });
    return false;
  }

  if (Number(partner.verification_status) !== PARTNER_VERIFICATION_STATUS_APPROVED) {
    res.status(403).json({
      success: false,
      status: 403,
      message: RESTRICTED_UNTIL_APPROVED_MESSAGE,
    });
    return false;
  }

  return true;
};

const partnerUpdateMyServicesMiddleware = async (req, res, next) => {
  parseJSONField(req, 'services');

  const services = req.body.services;
  if (!Array.isArray(services) || services.length === 0) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'services must be a non-empty array.',
    });
  }

  for (let i = 0; i < services.length; i++) {
    const item = services[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `services[${i}] must be an object.`,
      });
    }
  }

  try {
    const approved = await assertApprovedPartner(req, res);
    if (!approved) {
      return;
    }

    return next();
  } catch (err) {
    console.error('partnerUpdateMyServicesMiddleware', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const partnerPatchMyServiceStatusMiddleware = async (req, res, next) => {
  const id = req.params.id != null ? String(req.params.id).trim() : '';
  if (!id || !OBJECT_ID_HEX_24.test(id)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'id must be a valid id.',
    });
  }

  if (!isValidIsActive(req.body.is_active)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'is_active must be true or false.',
    });
  }

  try {
    const approved = await assertApprovedPartner(req, res);
    if (!approved) {
      return;
    }

    return next();
  } catch (err) {
    console.error('partnerPatchMyServiceStatusMiddleware', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const partnerPatchMyServicesBulkStatusMiddleware = async (req, res, next) => {
  parseJSONField(req, 'updates');

  const updates = req.body.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'updates must be a non-empty array.',
    });
  }

  for (let i = 0; i < updates.length; i++) {
    const item = updates[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `updates[${i}] must be an object.`,
      });
    }

    const rowId = item._id != null ? String(item._id).trim() : '';
    if (!rowId || !OBJECT_ID_HEX_24.test(rowId)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `updates[${i}]._id must be a valid id.`,
      });
    }

    if (!isValidIsActive(item.is_active)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `updates[${i}].is_active must be true or false.`,
      });
    }
  }

  try {
    const approved = await assertApprovedPartner(req, res);
    if (!approved) {
      return;
    }

    return next();
  } catch (err) {
    console.error('partnerPatchMyServicesBulkStatusMiddleware', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  partnerUpdateMyServicesMiddleware,
  partnerPatchMyServiceStatusMiddleware,
  partnerPatchMyServicesBulkStatusMiddleware,
};
