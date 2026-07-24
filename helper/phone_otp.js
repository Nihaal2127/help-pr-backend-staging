const Otp = require('../models/otp');
const { generateOtp, hashOtp } = require('./password_reset_otp');
const {
  normalizeUserPhone,
  getPhoneLookupVariants,
} = require('../utils/user_contact_uniqueness');
const {
  WHATSAPP_OTP_EXPIRY_MINUTES,
} = require('../config/env');

const MAX_PHONE_OTP_VERIFY_ATTEMPTS = 5;

const getPhoneOtpExpiryMs = () => WHATSAPP_OTP_EXPIRY_MINUTES * 60 * 1000;

const getPhoneOtpExpiryDate = () => new Date(Date.now() + getPhoneOtpExpiryMs());

/** Meta WhatsApp Cloud API expects digits only (e.g. 919876543210). */
const toWhatsAppRecipient = (phone_number) =>
  normalizeUserPhone(phone_number).replace(/\D/g, '');

const maskPhoneForLog = (phone_number) => {
  const digits = toWhatsAppRecipient(phone_number);
  if (digits.length <= 4) return '****';
  return `***${digits.slice(-4)}`;
};

const findActivePhoneOtp = async (phone_number) => {
  const normalizedPhone = normalizeUserPhone(phone_number);
  const phoneVariants = getPhoneLookupVariants(normalizedPhone);
  if (phoneVariants.length === 0) return null;

  return Otp.findOne({
    phone_number: { $in: phoneVariants },
    expiresAt: { $gt: new Date() },
  }).sort({ expiresAt: -1 });
};

const verifyPhoneOtpSubmission = async ({ phone_number, otp }) => {
  const normalizedPhone = normalizeUserPhone(phone_number);
  const phoneVariants = getPhoneLookupVariants(normalizedPhone);
  const submittedHash = hashOtp(String(otp).trim());

  const otpEntry = await Otp.findOne({
    phone_number: { $in: phoneVariants },
    expiresAt: { $gt: new Date() },
  }).sort({ expiresAt: -1 });

  if (!otpEntry) {
    return { ok: false, status: 400, message: 'Invalid OTP.' };
  }

  if (otpEntry.attempts >= MAX_PHONE_OTP_VERIFY_ATTEMPTS) {
    return {
      ok: false,
      status: 429,
      message: 'Maximum OTP verification attempts exceeded. Please request a new OTP.',
    };
  }

  if (otpEntry.otp !== submittedHash) {
    otpEntry.attempts += 1;
    await otpEntry.save();

    if (otpEntry.attempts >= MAX_PHONE_OTP_VERIFY_ATTEMPTS) {
      return {
        ok: false,
        status: 429,
        message: 'Maximum OTP verification attempts exceeded. Please request a new OTP.',
      };
    }

    return { ok: false, status: 400, message: 'Invalid OTP.' };
  }

  return { ok: true, otpEntry };
};

module.exports = {
  MAX_PHONE_OTP_VERIFY_ATTEMPTS,
  generateOtp,
  hashOtp,
  getPhoneOtpExpiryMs,
  getPhoneOtpExpiryDate,
  toWhatsAppRecipient,
  maskPhoneForLog,
  findActivePhoneOtp,
  verifyPhoneOtpSubmission,
};
