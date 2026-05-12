const { parseNumberField, parseBooleanField } = require('../utils/multipart_parser');

const USER_TYPE_PARTNER = 2;

/**
 * Mobile partner self-registration: no JWT. Only allowed when creating a partner (type 2)
 * from the app (is_from_web === false). Web/admin onboarding must use POST /create with auth.
 */
const publicPartnerRegisterMiddleware = (req, res, next) => {
  parseNumberField(req, 'type');
  parseBooleanField(req, 'is_from_web');

  const targetType = Number(req.body.type);
  const isFromWeb = req.body.is_from_web;

  if (!Number.isInteger(targetType) || targetType !== USER_TYPE_PARTNER) {
    return res.status(403).json({
      success: false,
      status: 403,
      message: 'This endpoint only accepts partner (mobile) registration.',
    });
  }

  if (isFromWeb !== false) {
    return res.status(403).json({
      success: false,
      status: 403,
      message: 'Web or admin-created partners must use POST /api/user/create with a valid token.',
    });
  }

  delete req.body.franchise_id;
  delete req.body.created_by_id;
  delete req.body.accessible_screens;

  next();
};

module.exports = { publicPartnerRegisterMiddleware };
