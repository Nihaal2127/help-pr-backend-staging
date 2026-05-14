const { deepApplyPublicImageUrls } = require('../helper/publicImageUrl');

/**
 * Wraps res.json so all JSON responses get CDN-prefixed image fields where configured.
 */
const publicImageUrlsResponseMiddleware = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function jsonWithPublicImageUrls(body) {
    try {
      return originalJson(deepApplyPublicImageUrls(body));
    } catch (err) {
      console.error('publicImageUrlsResponseMiddleware:', err.message);
      return originalJson(body);
    }
  };
  next();
};

module.exports = { publicImageUrlsResponseMiddleware };
