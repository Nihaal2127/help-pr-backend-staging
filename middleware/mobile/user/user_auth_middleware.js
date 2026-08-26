const jwt = require('jsonwebtoken');
const { USER_TYPE_CUSTOMER } = require('../../../constants/user_types');
const { sendAuthError, rejectIfAccountDeleted } = require('../common/reject_deleted_account');

/**
 * Customer mobile JWT guard. Validates Bearer token and ensures user.type === 4.
 */
const userAuthMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return sendAuthError(res, 401, 'Access denied. No token provided.');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (Number(decoded.type) !== USER_TYPE_CUSTOMER) {
      return sendAuthError(
        res,
        403,
        'This account is not a customer. Use the correct app to access this resource.'
      );
    }
    req.user = decoded;
    if (await rejectIfAccountDeleted(req, res)) {
      return;
    }
    next();
  } catch (err) {
    return sendAuthError(res, 401, 'Invalid token.');
  }
};

module.exports = userAuthMiddleware;
