const rateLimit = require('express-rate-limit');

/**
 * Per-IP rate limit for all /api/mobile routes.
 */
const mobileRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip || 'unknown',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      status: 429,
      message: 'Too many requests from this IP, please try again later.',
    });
  },
});

module.exports = mobileRateLimiter;
