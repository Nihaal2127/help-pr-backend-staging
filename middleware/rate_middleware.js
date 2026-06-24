const rateLimit = require('express-rate-limit');
const { proxySafeRateLimitOptions } = require('../utils/rate_limit_helpers');

const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 100 requests per window
  message: 'Too many requests from this IP, please try again later.',
  ...proxySafeRateLimitOptions,
});

module.exports = rateLimiter;
