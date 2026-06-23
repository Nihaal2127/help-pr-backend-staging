const mongoose = require('mongoose');
const {
  ALLOWED_CUSTOMER_PAYMENT_METHODS,
  ORDER_PAYMENT_STATUSES,
} = require('../../../utils/mobile_payment_constants');
const { buildFieldDateRangeFilter } = require('../../../utils/schedule_date_filters');

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validatePaymentMethod = (raw, res, { required }) => {
  const normalized =
    raw !== undefined && raw !== null ? String(raw).trim().toLowerCase() : '';
  if (!normalized) {
    if (required) {
      sendError(res, 400, 'payment_method is required.');
      return null;
    }
    return '';
  }
  if (!ALLOWED_CUSTOMER_PAYMENT_METHODS.has(normalized)) {
    sendError(
      res,
      400,
      `payment_method must be one of: ${Array.from(ALLOWED_CUSTOMER_PAYMENT_METHODS).join(', ')}.`
    );
    return null;
  }
  return normalized;
};

const validateOptionalDate = (value, fieldName, res) => {
  if (value === undefined || value === null || value === '') return true;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    sendError(res, 400, `${fieldName} must be a valid date.`);
    return false;
  }
  return true;
};

const validateListOrderPaymentsQuery = (req, res, next) => {
  const { order_id, status, payment_method } = req.query;

  if (order_id !== undefined && String(order_id).trim() !== '') {
    if (!mongoose.Types.ObjectId.isValid(String(order_id))) {
      return sendError(res, 400, 'Invalid order_id.');
    }
  }

  if (status !== undefined && String(status).trim() !== '') {
    const normalized = String(status).trim().toLowerCase();
    if (!ORDER_PAYMENT_STATUSES.has(normalized)) {
      return sendError(
        res,
        400,
        'status must be one of: pending, completed, failed, refunded.'
      );
    }
    req.query.status = normalized;
  }

  if (payment_method !== undefined && String(payment_method).trim() !== '') {
    const normalized = String(payment_method).trim().toLowerCase();
    if (!ALLOWED_CUSTOMER_PAYMENT_METHODS.has(normalized)) {
      return sendError(
        res,
        400,
        `payment_method must be one of: ${Array.from(ALLOWED_CUSTOMER_PAYMENT_METHODS).join(', ')}.`
      );
    }
    req.query.payment_method = normalized;
  }

  const dateResult = buildFieldDateRangeFilter(req.query, 'created_at');
  if (!dateResult.ok) {
    return sendError(res, 400, dateResult.message);
  }

  next();
};

const validatePaymentIdParam = (req, res, next) => {
  const paymentId = req.params.paymentId;
  if (paymentId === undefined || paymentId === null || String(paymentId).trim() === '') {
    return sendError(res, 400, 'paymentId is required.');
  }
  if (!mongoose.Types.ObjectId.isValid(String(paymentId).trim())) {
    return sendError(res, 400, 'Invalid payment id.');
  }
  next();
};

const validateCreateOrderPaymentBody = (req, res, next) => {
  const body = req.body || {};

  if (body.amount === undefined || body.amount === null || String(body.amount).trim() === '') {
    return sendError(res, 400, 'amount is required.');
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return sendError(res, 400, 'amount must be >= 0.');
  }

  const paymentMethod = validatePaymentMethod(body.payment_method, res, { required: true });
  if (paymentMethod === null) return;

  let status = 'pending';
  if (body.status !== undefined && body.status !== null && String(body.status).trim() !== '') {
    status = String(body.status).trim().toLowerCase();
    if (!ORDER_PAYMENT_STATUSES.has(status)) {
      return sendError(
        res,
        400,
        'status must be one of: pending, completed, failed, refunded.'
      );
    }
  }

  if (
    body.transaction_reference !== undefined &&
    body.transaction_reference !== null &&
    typeof body.transaction_reference !== 'string'
  ) {
    return sendError(res, 400, 'transaction_reference must be a string.');
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return sendError(res, 400, 'notes must be a string.');
  }
  if (
    body.installment_index !== undefined &&
    body.installment_index !== null &&
    body.installment_index !== ''
  ) {
    const idx = Number(body.installment_index);
    if (!Number.isFinite(idx)) {
      return sendError(res, 400, 'installment_index must be a number.');
    }
  }
  if (!validateOptionalDate(body.due_date, 'due_date', res)) return;
  if (!validateOptionalDate(body.paid_at, 'paid_at', res)) return;

  if (paymentMethod === 'online') {
    if (amount <= 0) {
      return sendError(res, 400, 'amount must be greater than 0 for online payments.');
    }
    if (status === 'completed') {
      return sendError(
        res,
        400,
        'Online payments cannot be marked completed until Razorpay confirms payment.'
      );
    }
    status = 'pending';
  }

  req.body = {
    ...body,
    amount,
    payment_method: paymentMethod,
    status,
  };
  next();
};

const validateUpdateOrderPaymentBody = (req, res, next) => {
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

  if (body.payment_method !== undefined) {
    const paymentMethod = validatePaymentMethod(body.payment_method, res, { required: true });
    if (paymentMethod === null) return;
    body.payment_method = paymentMethod;
  }

  if (body.status !== undefined) {
    const status = String(body.status).trim().toLowerCase();
    if (!ORDER_PAYMENT_STATUSES.has(status)) {
      return sendError(
        res,
        400,
        'status must be one of: pending, completed, failed, refunded.'
      );
    }
    body.status = status;
  }

  if (
    body.transaction_reference !== undefined &&
    body.transaction_reference !== null &&
    typeof body.transaction_reference !== 'string'
  ) {
    return sendError(res, 400, 'transaction_reference must be a string.');
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return sendError(res, 400, 'notes must be a string.');
  }
  if (
    body.installment_index !== undefined &&
    body.installment_index !== null &&
    body.installment_index !== ''
  ) {
    const idx = Number(body.installment_index);
    if (!Number.isFinite(idx)) {
      return sendError(res, 400, 'installment_index must be a number.');
    }
  }
  if (!validateOptionalDate(body.due_date, 'due_date', res)) return;
  if (!validateOptionalDate(body.paid_at, 'paid_at', res)) return;

  req.body = body;
  next();
};

module.exports = {
  validateListOrderPaymentsQuery,
  validatePaymentIdParam,
  validateCreateOrderPaymentBody,
  validateUpdateOrderPaymentBody,
};
