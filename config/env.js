require('dotenv').config();

module.exports = {
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_REGION: process.env.AWS_REGION,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  LOCAL_IMAGE_DIR: process.env.LOCAL_IMAGE_DIR,
  NODE_ENV: process.env.NODE_ENV,  // 'production' or 'development'
};