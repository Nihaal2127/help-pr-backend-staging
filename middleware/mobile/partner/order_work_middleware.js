const { normalizePartnerWorkStatus } = require('../../../enum/partner_work_status_enum');
const { MIN_IMAGES, MAX_IMAGES } = require('../../../services/partner_post_common_service');

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validateUpdateWorkStatusBody = (req, res, next) => {
  const statusRaw = req.body?.partner_work_status;
  if (statusRaw === undefined || statusRaw === null || String(statusRaw).trim() === '') {
    return sendError(res, 400, 'partner_work_status is required.');
  }

  if (!normalizePartnerWorkStatus(statusRaw)) {
    return sendError(res, 409, 'Invalid partner_work_status. Use pending, in-progress, or completed.');
  }

  next();
};

const validateCompleteOrderWorkBody = (req, res, next) => {
  const files = req.files || [];
  if (files.length < MIN_IMAGES || files.length > MAX_IMAGES) {
    return sendError(
      res,
      400,
      `Provide between ${MIN_IMAGES} and ${MAX_IMAGES} proof images.`
    );
  }

  next();
};

module.exports = {
  validateUpdateWorkStatusBody,
  validateCompleteOrderWorkBody,
};
