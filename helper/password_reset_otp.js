const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const RESET_TOKEN_EXPIRY = '10m';
const MAX_OTP_ATTEMPTS = 5;
const FORGOT_PASSWORD_COOLDOWN_MS = 60 * 1000;

const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp).trim()).digest('hex');

const getOtpExpiryDate = () => new Date(Date.now() + OTP_EXPIRY_MS);

const generatePasswordResetToken = ({ userId, userType, otpId }) =>
  jwt.sign(
    {
      id: userId,
      type: userType,
      purpose: 'password_reset',
      otpId: String(otpId),
    },
    process.env.JWT_SECRET,
    { expiresIn: RESET_TOKEN_EXPIRY }
  );

const verifyPasswordResetToken = (token) => {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.purpose !== 'password_reset') {
    throw new Error('Invalid reset token.');
  }
  return payload;
};

module.exports = {
  OTP_EXPIRY_MS,
  RESET_TOKEN_EXPIRY,
  MAX_OTP_ATTEMPTS,
  FORGOT_PASSWORD_COOLDOWN_MS,
  generateOtp,
  hashOtp,
  getOtpExpiryDate,
  generatePasswordResetToken,
  verifyPasswordResetToken,
};
