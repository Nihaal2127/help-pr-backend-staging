const rateLimit = require('express-rate-limit');
const { proxySafeRateLimitOptions } = require('../../../utils/rate_limit_helpers');

/**
 * Per-IP rate limit for /api/mobile common routes.
 */
const commonRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  ...proxySafeRateLimitOptions,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      status: 429,
      message: 'Too many requests from this IP, please try again later.',
    });
  },
});

module.exports = commonRateLimiter;
