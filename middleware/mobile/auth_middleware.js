const jwt = require('jsonwebtoken');

/**
 * Mobile API JWT guard. Validates Bearer token from partner/customer mobile apps.
 * Sets req.user from token payload (id, email, type).
 */
const mobileAuthMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      status: 401,
      message: 'Access denied. No token provided.',
    });
  }

  try {
    if (!req.user) {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    }
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      status: 401,
      message: 'Invalid token.',
    });
  }
};

module.exports = mobileAuthMiddleware;
