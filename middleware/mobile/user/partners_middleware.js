const mongoose = require('mongoose');

const validatePartnersListQuery = (req, res, next) => {
  const franchiseId = req.query.franchise_id;
  if (franchiseId === undefined || franchiseId === null || String(franchiseId).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'franchise_id is required.',
    });
  }

  if (!mongoose.Types.ObjectId.isValid(String(franchiseId).trim())) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'franchise_id must be a valid ObjectId.',
    });
  }

  next();
};

const validatePartnerProfileQuery = (req, res, next) => {
  const franchiseId = req.query.franchise_id;
  if (franchiseId === undefined || franchiseId === null || String(franchiseId).trim() === '') {
    return next();
  }

  if (!mongoose.Types.ObjectId.isValid(String(franchiseId).trim())) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'franchise_id must be a valid ObjectId.',
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
      message: 'partnerId is required.',
    });
  }

  if (!mongoose.Types.ObjectId.isValid(String(partnerId).trim())) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'partnerId must be a valid ObjectId.',
    });
  }

  next();
};

module.exports = {
  validatePartnersListQuery,
  validatePartnerProfileQuery,
  validatePartnerIdParam,
};
