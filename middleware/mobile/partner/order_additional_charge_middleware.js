const mongoose = require('mongoose');

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validateChargeIdParam = (req, res, next) => {
  const chargeId = req.params.chargeId;
  if (chargeId === undefined || chargeId === null || String(chargeId).trim() === '') {
    return sendError(res, 400, 'chargeId is required.');
  }
  if (!mongoose.Types.ObjectId.isValid(String(chargeId).trim())) {
    return sendError(res, 400, 'Invalid charge id.');
  }
  next();
};

const validateCreateAdditionalChargeBody = (req, res, next) => {
  const body = req.body || {};

  if (body.amount === undefined || body.amount === null || String(body.amount).trim() === '') {
    return sendError(res, 400, 'amount is required.');
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return sendError(res, 400, 'amount is required and must be >= 0.');
  }

  if (body.label !== undefined && body.label !== null && typeof body.label !== 'string') {
    return sendError(res, 400, 'label must be a string.');
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return sendError(res, 400, 'description must be a string.');
  }
  if (body.charge_type !== undefined && body.charge_type !== null && typeof body.charge_type !== 'string') {
    return sendError(res, 400, 'charge_type must be a string.');
  }
  if (
    body.payment_method !== undefined &&
    body.payment_method !== null &&
    typeof body.payment_method !== 'string'
  ) {
    return sendError(res, 400, 'payment_method must be a string.');
  }

  req.body = { ...body, amount };
  next();
};

const validateUpdateAdditionalChargeBody = (req, res, next) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return sendError(res, 400, 'At least one field is required to update.');
  }

  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return sendError(res, 400, 'amount must be >= 0.');
    }
    body.amount = amount;
  }

  if (body.label !== undefined && body.label !== null && typeof body.label !== 'string') {
    return sendError(res, 400, 'label must be a string.');
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return sendError(res, 400, 'description must be a string.');
  }
  if (body.charge_type !== undefined && body.charge_type !== null && typeof body.charge_type !== 'string') {
    return sendError(res, 400, 'charge_type must be a string.');
  }
  if (
    body.payment_method !== undefined &&
    body.payment_method !== null &&
    typeof body.payment_method !== 'string'
  ) {
    return sendError(res, 400, 'payment_method must be a string.');
  }

  req.body = body;
  next();
};

module.exports = {
  validateChargeIdParam,
  validateCreateAdditionalChargeBody,
  validateUpdateAdditionalChargeBody,
};
