const Otp = require('../models/otp');
const { validatePhoneNumber } = require('../validator/form_validator');
const { normalizeUserPhone } = require('../utils/user_contact_uniqueness');
const {
  findActivePhoneOtp,
  verifyPhoneOtpSubmission,
} = require('../helper/phone_otp');

const otpMiddleware = {
  validateOtp: async (req, res, next) => {
    const { phone_number, otp } = req.body;

    try {
      const phoneNumberResult = validatePhoneNumber(phone_number);
      if (phoneNumberResult.valid === false) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: phoneNumberResult.message,
        });
      }

      req.body.phone_number = normalizeUserPhone(phone_number);

      const verification = await verifyPhoneOtpSubmission({
        phone_number: req.body.phone_number,
        otp,
      });

      if (!verification.ok) {
        return res.status(verification.status).json({
          success: false,
          status: verification.status,
          message: verification.message,
        });
      }

      req.validOtp = verification.otpEntry;
      next();
    } catch (error) {
      console.error('Error validating OTP:', error);
      res.status(500).json({
        success: false,
        status: 500,
        message: 'Server error during OTP validation',
      });
    }
  },

  rateLimitOtpRequests: async (req, res, next) => {
    const { phone_number } = req.body;

    try {
      const phoneNumberResult = validatePhoneNumber(phone_number);
      if (phoneNumberResult.valid === false) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: phoneNumberResult.message,
        });
      }

      const normalizedPhone = normalizeUserPhone(phone_number);
      req.body.phone_number = normalizedPhone;

      const existingOtp = await findActivePhoneOtp(normalizedPhone);
      if (existingOtp) {
        return res.status(429).json({
          success: false,
          status: 429,
          message:
            'An OTP has already been sent to this phone number. Please wait before requesting again.',
        });
      }

      next();
    } catch (error) {
      console.error('Error checking OTP rate limit:', error);
      res.status(500).json({
        success: false,
        status: 500,
        message: 'Server error during OTP request validation',
      });
    }
  },
};

module.exports = otpMiddleware;
