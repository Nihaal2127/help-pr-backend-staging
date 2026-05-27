const express = require('express');
const {
  sendOtpHandler,
  verifyOtpHandler,
  updateHandler,
  getPincodesHandler,
} = require('../../../controllers/mobile/user/user_controller');
const {
  rateLimitSendOtp,
  validateVerifyOtp,
  userRequireMultipartMiddleware,
  userProfileImageSizeMiddleware,
  userUpdateMiddleware,
} = require('../../../middleware/mobile/user/user_middleware');
const userAuthMiddleware = require('../../../middleware/mobile/user/user_auth_middleware');
const addressRoutes = require('./address_routes');
const { uploadImages } = require('../../../utils/fileUpload');

const userMultipartUpload = uploadImages.fields([{ name: 'profile_photo', maxCount: 1 }]);

const router = express.Router();

router.use(addressRoutes);
router.get('/pincodes', userAuthMiddleware, getPincodesHandler);
router.post('/send-otp', rateLimitSendOtp, sendOtpHandler);
router.post('/verify-otp', validateVerifyOtp, verifyOtpHandler);
router.put(
  '/update',
  userAuthMiddleware,
  userRequireMultipartMiddleware,
  userMultipartUpload,
  userProfileImageSizeMiddleware,
  userUpdateMiddleware,
  updateHandler
);

module.exports = router;
