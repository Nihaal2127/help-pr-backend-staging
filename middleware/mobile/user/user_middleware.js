const crypto = require('crypto');
const Otp = require('../../../models/otp');
const { validatePhoneNumber } = require('../../../validator/form_validator');
const { normalizeUserPhone } = require('../../../utils/user_contact_uniqueness');

const validateAndNormalizePhone = (req, res) => {
  const { phone_number } = req.body;
  const phoneResult = validatePhoneNumber(phone_number);
  if (phoneResult.valid === false) {
    res.status(400).json({
      success: false,
      status: 400,
      message: phoneResult.message,
    });
    return null;
  }
  const normalized = normalizeUserPhone(phone_number);
  req.body.phone_number = normalized;
  return normalized;
};

const rateLimitSendOtp = async (req, res, next) => {
  const normalized = validateAndNormalizePhone(req, res);
  if (!normalized) return;

  try {
    const existingOtp = await Otp.findOne({
      phone_number: normalized,
      expiresAt: { $gt: new Date() },
    });

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
    console.error('mobile user send-otp rate limit', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Server error during OTP request validation.',
    });
  }
};

const validateVerifyOtp = async (req, res, next) => {
  const normalized = validateAndNormalizePhone(req, res);
  if (!normalized) return;

  const { otp } = req.body;
  if (otp === undefined || otp === null || String(otp).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'OTP is required.',
    });
  }

  try {
    const hashedOtp = crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
    const otpEntry = await Otp.findOne({ phone_number: normalized, otp: hashedOtp });

    if (!otpEntry) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid OTP.',
      });
    }

    if (otpEntry.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'OTP has expired.',
      });
    }

    req.validOtp = otpEntry;
    next();
  } catch (error) {
    console.error('mobile user verify-otp validation', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Server error during OTP validation.',
    });
  }
};

module.exports = {
  rateLimitSendOtp,
  validateVerifyOtp,
};
