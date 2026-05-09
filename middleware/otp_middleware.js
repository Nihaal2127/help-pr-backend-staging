const Otp = require('../models/otp');
const { validatePhoneNumber } = require('../validator/form_validator');
const crypto = require('crypto');

const otpMiddleware = {
  // Middleware to check if the OTP exists and is valid
  validateOtp: async (req, res, next) => {
    const { phone_number, otp } = req.body;

    try {
      let phoneNumberResult = validatePhoneNumber(phone_number)
      if (phoneNumberResult.valid === false) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: phoneNumberResult.message
        });
      }

      // Hash the OTP for comparison
      const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

      // Find the OTP in the database
      const otpEntry = await Otp.findOne({ phone_number, otp: hashedOtp });

      if (!otpEntry) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Invalid OTP'
        });
      }

      // Check if the OTP has expired
      if (otpEntry.expiresAt < new Date()) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'OTP has expired'
        });
      }

      // Attach OTP info to the request object for further processing
      req.validOtp = otpEntry;
      next();
    } catch (error) {
      console.error('Error validating OTP:', error);
      res.status(500).json({
        success: false,
        status: 500,
        message: 'Server error during OTP validation'
      });
    }
  },

  // Middleware to prevent multiple OTP requests for the same phone number in a short time
  rateLimitOtpRequests: async (req, res, next) => {
    const { phone_number } = req.body;

    try {
      let phoneNumberResult = validatePhoneNumber(phone_number)
      if (phoneNumberResult.valid === false) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: phoneNumberResult.message
        });
      }

      // Check if there's already a valid OTP for the phone number
      const existingOtp = await Otp.findOne({ phone_number, expiresAt: { $gt: new Date() } });

      if (existingOtp) {
        return res
          .status(429)
          .json({
            success: false,
            status: 429,
            message: 'An OTP has already been sent to this phone number. Please wait before requesting again.'
          });
      }

      next();
    } catch (error) {
      console.error('Error checking OTP rate limit:', error);
      res.status(500).json({
        success: false,
        status: 500,
        message: 'Server error during OTP request validation'
      });
    }
  },
};
module.exports = otpMiddleware;
