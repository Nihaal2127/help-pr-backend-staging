const jwt = require('jsonwebtoken');
const { USER_TYPE_CUSTOMER } = require('../../../constants/user_types');

/**
 * Customer mobile JWT guard. Validates Bearer token and ensures user.type === 4.
 */
const userAuthMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      status: 401,
      message: 'Access denied. No token provided.',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (Number(decoded.type) !== USER_TYPE_CUSTOMER) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'This account is not a customer. Use the correct app to access this resource.',
      });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      status: 401,
      message: 'Invalid token.',
    });
  }
};

module.exports = userAuthMiddleware;
