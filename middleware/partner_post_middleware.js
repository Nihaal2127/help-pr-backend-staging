const mongoose = require('mongoose');
const {
  normalizePostStatus,
  normalizeReportStatus,
} = require('../enum/post_report_reason_enum');

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validatePostIdParam = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.postId))) {
    return sendError(res, 400, 'Invalid post id.');
  }
  next();
};

const validateReportIdParam = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.reportId))) {
    return sendError(res, 400, 'Invalid report id.');
  }
  next();
};

const validateModeratePostBody = (req, res, next) => {
  const status = normalizePostStatus(req.body?.status);
  if (!status) {
    return sendError(res, 400, 'status must be one of: published, hidden, removed.');
  }
  req.body.status = status;
  next();
};

const validateUpdateReportBody = (req, res, next) => {
  const status = normalizeReportStatus(req.body?.status);
  if (!status || status === 'pending') {
    return sendError(res, 400, 'status must be reviewed or dismissed.');
  }
  req.body.status = status;
  next();
};

module.exports = {
  validatePostIdParam,
  validateReportIdParam,
  validateModeratePostBody,
  validateUpdateReportBody,
};
