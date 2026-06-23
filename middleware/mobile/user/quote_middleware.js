const mongoose = require('mongoose');
const Quote = require('../../../models/quote');
const { fieldLabel } = require('../../../utils/field_labels');
const { resolveTotalServiceCharge } = require('../../../utils/order_pricing');
const {
  DISALLOWED_CLIENT_PRICING_KEYS,
  TIME_REGEX,
  CUSTOMER_QUOTE_FIELD_UPDATE_KEYS,
} = require('../../../utils/mobile_quote_constants');
const { QUOTE_STATUSES, normalizeQuoteStatus } = require('../../../enum/quote_status_enum');
const { ALLOWED_CUSTOMER_PAYMENT_METHODS } = require('../../../utils/mobile_payment_constants');

const MAX_QUOTE_DESCRIPTION_LEN = 1000;

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const rejectClientComputedPricing = (body, res) => {
  const sent = DISALLOWED_CLIENT_PRICING_KEYS.filter((key) => body[key] !== undefined);
  if (sent.length === 0) return true;
  sendError(
    res,
    409,
    `Do not send server-computed pricing fields: ${sent.map(fieldLabel).join(', ')}. Send only ${fieldLabel('total_service_charge')} (or ${fieldLabel('service_price')}) on create.`
  );
  return false;
};

const parseDateEndOfDay = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const validateScheduleFields = (body, { partial }) => {
  if (!partial) {
    const from = parseDateEndOfDay(body.from_date);
    const to = parseDateEndOfDay(body.to_date);
    if (!from) return { ok: false, message: 'From date is required and must be valid.' };
    if (!to) return { ok: false, message: 'To date is required and must be valid.' };
    if (to < from) return { ok: false, message: 'To date must be on or after from date.' };
  } else {
    if (body.from_date !== undefined) {
      const from = parseDateEndOfDay(body.from_date);
      if (!from) return { ok: false, message: 'From date must be valid.' };
    }
    if (body.to_date !== undefined) {
      const to = parseDateEndOfDay(body.to_date);
      if (!to) return { ok: false, message: 'To date must be valid.' };
    }
  }

  if (!partial || body.work_hours_per_day !== undefined) {
    const wh = parseFloat(body.work_hours_per_day);
    if (!partial) {
      if (body.work_hours_per_day === undefined || Number.isNaN(wh) || wh <= 0) {
        return { ok: false, message: 'Work hours per day must be greater than 0.' };
      }
    } else if (Number.isNaN(wh) || wh <= 0) {
      return { ok: false, message: 'Work hours per day must be greater than 0.' };
    }
  }

  if (!partial || body.total_work_hours !== undefined) {
    const tw = parseFloat(body.total_work_hours);
    if (!partial) {
      if (body.total_work_hours === undefined || Number.isNaN(tw) || tw <= 0) {
        return { ok: false, message: 'Total work hours must be greater than 0.' };
      }
    } else if (Number.isNaN(tw) || tw <= 0) {
      return { ok: false, message: 'Total work hours must be greater than 0.' };
    }
  }

  if (!partial || body.work_start_time !== undefined) {
    const t = body.work_start_time;
    if (!t || typeof t !== 'string' || !TIME_REGEX.test(String(t).trim())) {
      return { ok: false, message: 'Work start time must be in HH:mm format.' };
    }
  }

  if (!partial || body.work_end_time !== undefined) {
    const t = body.work_end_time;
    if (!t || typeof t !== 'string' || !TIME_REGEX.test(String(t).trim())) {
      return { ok: false, message: 'Work end time must be in HH:mm format.' };
    }
  }

  if (body.quote_description !== undefined && body.quote_description !== null) {
    if (typeof body.quote_description !== 'string') {
      return { ok: false, message: 'Quote description must be a string.' };
    }
    if (body.quote_description.trim().length > MAX_QUOTE_DESCRIPTION_LEN) {
      return {
        ok: false,
        message: `Quote description must be ${MAX_QUOTE_DESCRIPTION_LEN} characters or fewer.`,
      };
    }
  }

  return { ok: true };
};

/** Omit or send empty partner_id to create a new (unassigned) quote; valid id → pending. */
const normalizeOptionalPartnerId = (body) => {
  if (body.partner_id === undefined || body.partner_id === null) {
    delete body.partner_id;
    return;
  }
  const trimmed = String(body.partner_id).trim();
  if (trimmed === '') {
    delete body.partner_id;
  } else {
    body.partner_id = trimmed;
  }
};

const validateCreateQuoteBody = (req, res, next) => {
  const body = req.body;
  if (!rejectClientComputedPricing(body, res)) return;

  normalizeOptionalPartnerId(body);

  if (!body.franchise_id || !mongoose.Types.ObjectId.isValid(String(body.franchise_id))) {
    return sendError(res, 400, 'Valid franchise_id is required.');
  }
  if (!body.category_id || !mongoose.Types.ObjectId.isValid(String(body.category_id))) {
    return sendError(res, 400, 'Valid category_id is required.');
  }
  if (!body.service_id || !mongoose.Types.ObjectId.isValid(String(body.service_id))) {
    return sendError(res, 400, 'Valid service_id is required.');
  }
  if (!body.address_id || !mongoose.Types.ObjectId.isValid(String(body.address_id))) {
    return sendError(res, 400, 'Valid address_id is required.');
  }

  if (body.partner_id !== undefined && !mongoose.Types.ObjectId.isValid(String(body.partner_id))) {
    return sendError(res, 400, 'Invalid partner_id.');
  }

  if (body.partner_id === undefined) {
    delete body.total_service_charge;
    delete body.service_price;
  } else {
    const charge = resolveTotalServiceCharge(body, {});
    if (charge !== null && charge <= 0) {
      delete body.total_service_charge;
      delete body.service_price;
    }
  }

  const schedule = validateScheduleFields(body, { partial: false });
  if (!schedule.ok) {
    return sendError(res, 409, schedule.message);
  }

  next();
};

const validateUpdateQuoteBody = (req, res, next) => {
  const body = req.body;
  if (!rejectClientComputedPricing(body, res)) return;

  if (body.partner_id !== undefined) {
    normalizeOptionalPartnerId(body);
  }

  if (body.total_service_charge !== undefined || body.service_price !== undefined) {
    return sendError(
      res,
      403,
      'Only admin users can update total_service_charge. Contact support to change pricing.'
    );
  }

  if (body.status !== undefined) {
    return sendError(
      res,
      409,
      'Use the cancel endpoint to cancel a quote. Status cannot be updated directly.'
    );
  }

  const allowedKeys = new Set([...CUSTOMER_QUOTE_FIELD_UPDATE_KEYS]);
  const unknown = Object.keys(body).filter((k) => !allowedKeys.has(k));
  if (unknown.length > 0) {
    return sendError(
      res,
      409,
      `Cannot update fields: ${unknown.map(fieldLabel).join(', ')}`
    );
  }

  if (Object.keys(body).length === 0) {
    return sendError(res, 409, 'No updatable fields provided.');
  }

  const schedule = validateScheduleFields(body, { partial: true });
  if (!schedule.ok) {
    return sendError(res, 409, schedule.message);
  }

  const needsCrossValidation =
    body.from_date !== undefined || body.to_date !== undefined;

  if (needsCrossValidation) {
    const quoteId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(quoteId)) {
      return sendError(res, 400, 'Invalid quote id.');
    }
    Quote.findById(quoteId)
      .lean()
      .then((existing) => {
        if (!existing) {
          return sendError(res, 404, 'Quote not found.');
        }
        const from = parseDateEndOfDay(
          body.from_date !== undefined ? body.from_date : existing.from_date
        );
        const to = parseDateEndOfDay(
          body.to_date !== undefined ? body.to_date : existing.to_date
        );
        if (from && to && to < from) {
          return sendError(res, 409, 'To date must be on or after from date.');
        }
        next();
      })
      .catch(() => sendError(res, 500, 'Internal server error.'));
    return;
  }

  next();
};

const validateQuoteIdParam = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
    return sendError(res, 400, 'Invalid quote id.');
  }
  next();
};

const validateListQuotesQuery = (req, res, next) => {
  const { status, franchise_id } = req.query;

  if (franchise_id !== undefined && String(franchise_id).trim() !== '') {
    if (!mongoose.Types.ObjectId.isValid(String(franchise_id))) {
      return sendError(res, 400, 'Invalid franchise_id.');
    }
  }

  if (status !== undefined && String(status).trim() !== '') {
    const normalized = normalizeQuoteStatus(String(status).trim());
    if (!normalized) {
      return sendError(
        res,
        409,
        `Invalid status. Use one of: ${QUOTE_STATUSES.join(', ')}.`
      );
    }
    req.query.status = normalized;
  }

  next();
};

const validateCancelQuoteBody = (req, res, next) => {
  const { cancellation_reason } = req.body || {};
  if (
    cancellation_reason !== undefined &&
    cancellation_reason !== null &&
    typeof cancellation_reason !== 'string'
  ) {
    return sendError(res, 400, 'cancellation_reason must be a string.');
  }
  next();
};

const validateConvertQuoteBody = (req, res, next) => {
  const body = req.body || {};
  const payment_method =
    body.payment_method !== undefined ? String(body.payment_method).trim().toLowerCase() : '';
  if (!payment_method) {
    return sendError(res, 400, 'payment_method is required.');
  }
  if (!ALLOWED_CUSTOMER_PAYMENT_METHODS.has(payment_method)) {
    return sendError(
      res,
      400,
      `payment_method must be one of: ${Array.from(ALLOWED_CUSTOMER_PAYMENT_METHODS).join(', ')}.`
    );
  }

  if (body.amount === undefined || body.amount === null || String(body.amount).trim() === '') {
    return sendError(res, 400, 'amount is required.');
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return sendError(res, 400, 'amount must be greater than 0.');
  }
  req.body.amount = amount;
  req.body.payment_method = payment_method;

  if (
    body.transaction_reference !== undefined &&
    body.transaction_reference !== null &&
    typeof body.transaction_reference !== 'string'
  ) {
    return sendError(res, 400, 'transaction_reference must be a string.');
  }
  if (
    body.notes !== undefined &&
    body.notes !== null &&
    typeof body.notes !== 'string'
  ) {
    return sendError(res, 400, 'notes must be a string.');
  }
  if (body.paid_at !== undefined && body.paid_at !== null && body.paid_at !== '') {
    const paidAt = new Date(body.paid_at);
    if (Number.isNaN(paidAt.getTime())) {
      return sendError(res, 400, 'paid_at must be a valid date.');
    }
  }

  if (payment_method === 'online') {
    if (
      body.payment_status !== undefined &&
      String(body.payment_status).trim().toLowerCase() === 'completed'
    ) {
      return sendError(
        res,
        400,
        'Online payments cannot be marked completed until Razorpay confirms payment.'
      );
    }
    req.body.payment_status = 'pending';
  }

  next();
};

module.exports = {
  validateCreateQuoteBody,
  validateUpdateQuoteBody,
  validateQuoteIdParam,
  validateListQuotesQuery,
  validateCancelQuoteBody,
  validateConvertQuoteBody,
};
