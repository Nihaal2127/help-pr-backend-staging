const mongoose = require('mongoose');
const User = require('../../../models/user');
const { parseJSONField } = require('../../../utils/multipart_parser');

const USER_TYPE_PARTNER = 2;
const PARTNER_VERIFICATION_STATUS_APPROVED = 2;

const RESTRICTED_UNTIL_APPROVED_MESSAGE =
  'Catalog, services, and bank details can only be updated after your account is verified and approved.';

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
    const partner = await User.findOne({
      _id: req.user.id,
      type: USER_TYPE_PARTNER,
      deleted_at: null,
    }).select('verification_status');

    if (!partner) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Partner not found.',
      });
    }

    if (Number(partner.verification_status) !== PARTNER_VERIFICATION_STATUS_APPROVED) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: RESTRICTED_UNTIL_APPROVED_MESSAGE,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(String(req.user.id))) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid token.',
      });
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

module.exports = {
  partnerUpdateMyServicesMiddleware,
};
