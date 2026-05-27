const jwt = require('jsonwebtoken');

/**
 * Partner mobile JWT guard. Validates Bearer token.
 * Sets req.user from token payload (id, email, type).
 */
const partnerAuthMiddleware = (req, res, next) => {
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
  } catch (_err) {
    return res.status(401).json({
      success: false,
      status: 401,
      message: 'Invalid token.',
    });
  }
};

module.exports = partnerAuthMiddleware;
