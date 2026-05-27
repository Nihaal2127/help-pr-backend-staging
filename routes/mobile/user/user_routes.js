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
  userUpdateMiddleware,
} = require('../../../middleware/mobile/user/user_middleware');
const mobileAuthMiddleware = require('../../../middleware/mobile/auth_middleware');

const router = express.Router();

router.get('/pincodes', getPincodesHandler);
router.post('/send-otp', rateLimitSendOtp, sendOtpHandler);
router.post('/verify-otp', validateVerifyOtp, verifyOtpHandler);
router.put('/update', mobileAuthMiddleware, userUpdateMiddleware, updateHandler);

module.exports = router;
