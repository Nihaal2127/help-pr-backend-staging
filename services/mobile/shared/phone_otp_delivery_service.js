const Otp = require('../../../models/otp');
const { sendVerificationOtp } = require('../../../helper/whatsapp');
const {
  generateOtp,
  hashOtp,
  getPhoneOtpExpiryDate,
} = require('../../../helper/phone_otp');
const {
  normalizeUserPhone,
  getPhoneLookupVariants,
} = require('../../../utils/user_contact_uniqueness');
const { fail } = require('../../../utils/mobile_service_result');

/**
 * Generate OTP, persist hash, and deliver via WhatsApp (or dev fallback).
 * Rolls back the DB record if delivery fails.
 */
const issueAndSendPhoneOtp = async ({ phone_number }) => {
  const normalizedPhone = normalizeUserPhone(phone_number);
  const phoneVariants = getPhoneLookupVariants(normalizedPhone);
  const plainOtp = generateOtp();
  const expiresAt = getPhoneOtpExpiryDate();

  await Otp.deleteMany({ phone_number: { $in: phoneVariants } });

  const otpRecord = await Otp.create({
    phone_number: normalizedPhone,
    otp: hashOtp(plainOtp),
    expiresAt,
    attempts: 0,
  });

  const delivery = await sendVerificationOtp({
    phone_number: normalizedPhone,
    otp: plainOtp,
  });

  if (!delivery.ok) {
    await Otp.deleteOne({ _id: otpRecord._id });
    return fail(503, 'Unable to send OTP. Please try again later.');
  }

  if (delivery.messageId) {
    otpRecord.provider_message_id = delivery.messageId;
    await otpRecord.save();
  }

  return {
    ok: true,
    status: 200,
    message: 'OTP sent successfully.',
  };
};

module.exports = {
  issueAndSendPhoneOtp,
};
