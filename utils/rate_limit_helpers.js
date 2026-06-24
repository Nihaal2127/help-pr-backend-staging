/**
 * Client key for express-rate-limit behind API Gateway / reverse proxies (incl. AWS Lambda).
 * Custom keyGenerator disables built-in IP detection, so we disable strict validations too.
 */
const getRateLimitClientKey = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const firstHop = String(forwarded).split(',')[0].trim();
    if (firstHop) return firstHop;
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

const proxySafeRateLimitOptions = {
  validate: {
    xForwardedForHeader: false,
    ip: false,
  },
  keyGenerator: getRateLimitClientKey,
};

module.exports = {
  getRateLimitClientKey,
  proxySafeRateLimitOptions,
};
