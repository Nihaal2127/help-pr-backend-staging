const mongoose = require('mongoose');
const { fieldLabel } = require('../utils/field_labels');

const validatePartnerProfileQuery = (req, res, next) => {
  const franchiseId = req.query.franchise_id;
  if (franchiseId === undefined || franchiseId === null || String(franchiseId).trim() === '') {
    return next();
  }

  if (!mongoose.Types.ObjectId.isValid(String(franchiseId).trim())) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: `${fieldLabel('franchise_id')} must be a valid ObjectId.`,
    });
  }

  next();
};

const validatePartnerIdParam = (req, res, next) => {
  const partnerId = req.params.partnerId;
  if (partnerId === undefined || partnerId === null || String(partnerId).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: `${fieldLabel('partnerId')} is required.`,
    });
  }

  if (!mongoose.Types.ObjectId.isValid(String(partnerId).trim())) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: `${fieldLabel('partnerId')} must be a valid ObjectId.`,
    });
  }

  next();
};

module.exports = {
  validatePartnerProfileQuery,
  validatePartnerIdParam,
};
