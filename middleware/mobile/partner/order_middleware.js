const mongoose = require('mongoose');
const { fieldLabel } = require('../../../utils/field_labels');

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validateOrderIdParam = (req, res, next) => {
  const orderId = req.params.orderId;
  if (orderId === undefined || orderId === null || String(orderId).trim() === '') {
    return sendError(res, 400, `${fieldLabel('orderId')} is required.`);
  }
  if (!mongoose.Types.ObjectId.isValid(String(orderId).trim())) {
    return sendError(res, 400, 'Invalid order id.');
  }
  next();
};

module.exports = {
  validateOrderIdParam,
};
