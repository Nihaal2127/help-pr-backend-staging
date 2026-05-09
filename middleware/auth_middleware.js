const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success:false,
      status:401,
      message: 'Access denied. No token provided.' 
    });
  }

  try {
    if (!req.user) {
      req.user = jwt.verify(token, process.env.JWT_SECRET); // Cache decoded token
    } 
    next();
  } catch (err) {
    res.status(401).json({ 
      success:false,
      status:401,
      message: 'Invalid token.' 
    });
  }
};

module.exports = authMiddleware;
