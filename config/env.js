require('dotenv').config();

module.exports = {
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_REGION: process.env.AWS_REGION,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  LOCAL_IMAGE_DIR: process.env.LOCAL_IMAGE_DIR,
  /** No trailing slash. Used to turn stored keys/paths into full image URLs in API JSON. */
  IMAGE_CDN_BASE_URL: process.env.IMAGE_CDN_BASE_URL || process.env.CDN_BASE_URL,
  NODE_ENV: process.env.NODE_ENV,  // 'production' or 'development'
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
  /** Public URL Razorpay can reach (ngrok/production host) — separate from Postman `baseUrl`. */
  RAZORPAY_BASE_URL: process.env.RAZORPAY_BASE_URL,
};