const mongoose = require('mongoose');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');
const { QUOTE_STATUSES, normalizeQuoteStatus } = require('../../../enum/quote_status_enum');

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const requirePartnerAccount = (req, res, next) => {
  if (!req.user || Number(req.user.type) !== USER_TYPE_PARTNER) {
    return sendError(
      res,
      403,
      'This account is not a partner. Use the partner app to access this resource.'
    );
  }
  next();
};

const validateQuoteIdParam = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
    return sendError(res, 400, 'Invalid quote id.');
  }
  next();
};

const validateListPartnerQuotesQuery = (req, res, next) => {
  const { status } = req.query;
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

const validatePartnerStatusBody = (req, res, next) => {
  const { status } = req.body || {};
  if (status === undefined || status === null || String(status).trim() === '') {
    return sendError(res, 400, 'status is required.');
  }

  const normalized = normalizeQuoteStatus(status);
  if (!normalized) {
    return sendError(
      res,
      409,
      `Invalid status. Partners may set: accepted, failed.`
    );
  }

  if (!['accepted', 'failed'].includes(normalized)) {
    return sendError(res, 409, 'Partners can only set status to accepted or failed.');
  }

  req.body.status = normalized;

  if (normalized === 'failed') {
    const { rejection_reason, cancellation_reason } = req.body;
    if (
      rejection_reason !== undefined &&
      rejection_reason !== null &&
      typeof rejection_reason !== 'string'
    ) {
      return sendError(res, 400, 'rejection_reason must be a string.');
    }
    if (
      cancellation_reason !== undefined &&
      cancellation_reason !== null &&
      typeof cancellation_reason !== 'string'
    ) {
      return sendError(res, 400, 'cancellation_reason must be a string.');
    }
  }

  next();
};

module.exports = {
  requirePartnerAccount,
  validateQuoteIdParam,
  validateListPartnerQuotesQuery,
  validatePartnerStatusBody,
};
