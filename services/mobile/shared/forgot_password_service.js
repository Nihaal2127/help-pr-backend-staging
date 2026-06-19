const User = require('../../../models/user');
const PasswordResetOtp = require('../../../models/password_reset_otp');
const { sendTemplateEmail } = require('../../../helper/mail');
const { buildPasswordResetOtpEmail } = require('../../../helper/email_templates/password_reset_otp_email');
const {
  generateOtp,
  hashOtp,
  getOtpExpiryDate,
  generatePasswordResetToken,
  verifyPasswordResetToken,
  MAX_OTP_ATTEMPTS,
  FORGOT_PASSWORD_COOLDOWN_MS,
} = require('../../../helper/password_reset_otp');
const { normalizeUserEmail } = require('../../../utils/user_contact_uniqueness');
const { fail, okWithMessage } = require('../../../utils/mobile_service_result');

const GENERIC_FORGOT_PASSWORD_MESSAGE = 'If an account exists, an OTP has been sent.';

const findUserByEmailAndType = async (email, userType) => {
  const normalizedEmail = normalizeUserEmail(email);
  const user = await User.findOne({ email: normalizedEmail, deleted_at: null });
  if (!user || Number(user.type) !== Number(userType)) {
    return null;
  }
  return user;
};

const requestForgotPasswordOtp = async ({ email, userType }) => {
  const normalizedEmail = normalizeUserEmail(email);
  const user = await findUserByEmailAndType(normalizedEmail, userType);

  if (user) {
    const cooldownSince = new Date(Date.now() - FORGOT_PASSWORD_COOLDOWN_MS);
    const recentOtp = await PasswordResetOtp.findOne({
      user_id: user._id,
      verified: false,
      created_at: { $gt: cooldownSince },
    }).sort({ created_at: -1 });

    if (!recentOtp) {
      await PasswordResetOtp.deleteMany({ user_id: user._id });

      const otp = generateOtp();
      await PasswordResetOtp.create({
        user_id: user._id,
        otp_hash: hashOtp(otp),
        expires_at: getOtpExpiryDate(),
      });

      const { subject, text, html } = buildPasswordResetOtpEmail(otp);
      await sendTemplateEmail(normalizedEmail, subject, html, text);
    }
  }

  return okWithMessage(200, GENERIC_FORGOT_PASSWORD_MESSAGE);
};

const verifyForgotPasswordOtp = async ({ email, otp, userType }) => {
  const normalizedEmail = normalizeUserEmail(email);
  const user = await findUserByEmailAndType(normalizedEmail, userType);

  if (!user) {
    return fail(400, 'Invalid OTP.');
  }

  const otpRecord = await PasswordResetOtp.findOne({
    user_id: user._id,
    verified: false,
  }).sort({ created_at: -1 });

  if (!otpRecord) {
    return fail(400, 'Invalid OTP.');
  }

  if (otpRecord.expires_at < new Date()) {
    await PasswordResetOtp.deleteOne({ _id: otpRecord._id });
    return fail(400, 'OTP has expired.');
  }

  if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
    return fail(429, 'Maximum OTP verification attempts exceeded. Please request a new OTP.');
  }

  const submittedHash = hashOtp(otp);
  if (submittedHash !== otpRecord.otp_hash) {
    otpRecord.attempts += 1;
    await otpRecord.save();

    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
      return fail(429, 'Maximum OTP verification attempts exceeded. Please request a new OTP.');
    }

    return fail(400, 'Invalid OTP.');
  }

  otpRecord.verified = true;
  await otpRecord.save();

  const resetToken = generatePasswordResetToken({
    userId: user._id,
    userType: user.type,
    otpId: otpRecord._id,
  });

  return {
    ok: true,
    status: 200,
    verified: true,
    reset_token: resetToken,
  };
};

const resetPasswordWithToken = async ({ resetToken, newPassword, userType }) => {
  let payload;
  try {
    payload = verifyPasswordResetToken(resetToken);
  } catch {
    return fail(400, 'Invalid or expired reset token.');
  }

  if (Number(payload.type) !== Number(userType)) {
    return fail(400, 'Invalid or expired reset token.');
  }

  const otpRecord = await PasswordResetOtp.findOne({
    _id: payload.otpId,
    user_id: payload.id,
    verified: true,
  });

  if (!otpRecord) {
    return fail(400, 'Invalid or expired reset token.');
  }

  const user = await User.findById(payload.id).select('+password');
  if (!user || user.deleted_at) {
    return fail(400, 'Invalid or expired reset token.');
  }

  user.password = newPassword;
  await user.save();

  await PasswordResetOtp.deleteMany({ user_id: user._id });

  return okWithMessage(200, 'Password updated successfully');
};

module.exports = {
  requestForgotPasswordOtp,
  verifyForgotPasswordOtp,
  resetPasswordWithToken,
  GENERIC_FORGOT_PASSWORD_MESSAGE,
};
