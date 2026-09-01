const { normalizePartnerWorkStatus } = require('../../../enum/partner_work_status_enum');
const { inspectCompleteOrderMedia } = require('../../../services/mobile/partner/complete_order_media');
const { fieldLabel } = require('../../../utils/field_labels');

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validateUpdateWorkStatusBody = (req, res, next) => {
  const statusRaw = req.body?.partner_work_status;
  if (statusRaw === undefined || statusRaw === null || String(statusRaw).trim() === '') {
    return sendError(res, 400, `${fieldLabel('partner_work_status')} is required.`);
  }

  if (!normalizePartnerWorkStatus(statusRaw)) {
    return sendError(res, 409, `Invalid ${fieldLabel('partner_work_status')}. Use pending, in-progress, or completed.`);
  }

  next();
};

const validateCompleteOrderWorkBody = (req, res, next) => {
  const inspected = inspectCompleteOrderMedia(req.files || [], req.body);
  if (inspected.error) {
    return sendError(res, 400, inspected.error);
  }

  next();
};

module.exports = {
  validateUpdateWorkStatusBody,
  validateCompleteOrderWorkBody,
};
