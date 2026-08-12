const mongoose = require('mongoose');
const { fieldLabel } = require('../../../utils/field_labels');

const validateOrderIdParam = (req, res, next) => {
  const orderId = req.params.orderId;
  if (orderId === undefined || orderId === null || String(orderId).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: `${fieldLabel('orderId')} is required.`,
    });
  }
  if (!mongoose.Types.ObjectId.isValid(String(orderId).trim())) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid order id.',
    });
  }
  next();
};

module.exports = {
  validateOrderIdParam,
};
