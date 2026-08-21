const mongoose = require('mongoose');
const { fieldLabel } = require('../../../utils/field_labels');

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validateRequiredServiceIdQuery = (req, res, next) => {
  const serviceId = req.query.service_id;
  if (serviceId === undefined || serviceId === null || String(serviceId).trim() === '') {
    return sendError(res, 400, `${fieldLabel('service_id')} is required.`);
  }

  if (!mongoose.Types.ObjectId.isValid(String(serviceId).trim())) {
    return sendError(res, 400, `${fieldLabel('service_id')} must be a valid ObjectId.`);
  }

  next();
};

module.exports = {
  validateRequiredServiceIdQuery,
};
