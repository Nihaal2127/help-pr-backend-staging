const express = require('express');
const {
  sendOtpHandler,
  verifyOtpHandler,
} = require('../../../controllers/mobile/user/user_controller');
const {
  rateLimitSendOtp,
  validateVerifyOtp,
} = require('../../../middleware/mobile/user/user_middleware');

const router = express.Router();

router.post('/send-otp', rateLimitSendOtp, sendOtpHandler);
router.post('/verify-otp', validateVerifyOtp, verifyOtpHandler);

module.exports = router;
