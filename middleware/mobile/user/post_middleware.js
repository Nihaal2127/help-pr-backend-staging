const mongoose = require('mongoose');
const { normalizeReportReason } = require('../../../enum/post_report_reason_enum');

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validateFranchiseIdQuery = (req, res, next) => {
  const franchiseId = req.query.franchise_id;
  if (franchiseId === undefined || franchiseId === null || String(franchiseId).trim() === '') {
    return sendError(res, 400, 'franchise_id is required.');
  }

  if (!mongoose.Types.ObjectId.isValid(String(franchiseId).trim())) {
    return sendError(res, 400, 'franchise_id must be a valid ObjectId.');
  }

  next();
};

const validatePostIdParam = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.postId))) {
    return sendError(res, 400, 'Invalid post id.');
  }
  next();
};

const validatePartnerIdParam = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.partnerId))) {
    return sendError(res, 400, 'Invalid partner id.');
  }
  next();
};

const validateShareTokenParam = (req, res, next) => {
  const token = String(req.params.shareToken ?? '').trim();
  if (!token) {
    return sendError(res, 400, 'share token is required.');
  }
  next();
};

const validateReportBody = (req, res, next) => {
  const { reason } = req.body || {};
  if (!normalizeReportReason(reason)) {
    return sendError(res, 400, 'reason must be one of: spam, inappropriate, misleading, other.');
  }
  next();
};

module.exports = {
  validateFranchiseIdQuery,
  validatePostIdParam,
  validatePartnerIdParam,
  validateShareTokenParam,
  validateReportBody,
};
