const jwt = require('jsonwebtoken');
const { sendAuthError, rejectIfAccountDeleted } = require('../common/reject_deleted_account');

/**
 * Partner mobile JWT guard. Validates Bearer token.
 * Sets req.user from token payload (id, email, type).
 */
const partnerAuthMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return sendAuthError(res, 401, 'Access denied. No token provided.');
  }

  try {
    if (!req.user) {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    }
    if (await rejectIfAccountDeleted(req, res)) {
      return;
    }
    next();
  } catch (_err) {
    return sendAuthError(res, 401, 'Invalid token.');
  }
};

module.exports = partnerAuthMiddleware;
