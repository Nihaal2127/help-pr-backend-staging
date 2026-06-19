const { normalizeUserEmail } = require('../../../utils/user_contact_uniqueness');
const { validatePassword } = require('../../../validator/form_validator');

const EMAIL_REGEX = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

const validateForgotPasswordEmail = (req, res, next) => {
  const { email } = req.body;

  if (!email || String(email).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Email is required.',
    });
  }

  const normalizedEmail = normalizeUserEmail(email);
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid email format.',
    });
  }

  req.body.email = normalizedEmail;
  next();
};

const validateVerifyForgotPasswordOtp = (req, res, next) => {
  const { email, otp } = req.body;

  if (!email || String(email).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Email is required.',
    });
  }

  const normalizedEmail = normalizeUserEmail(email);
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid email format.',
    });
  }

  req.body.email = normalizedEmail;
  if (otp === undefined || otp === null || String(otp).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'OTP is required.',
    });
  }

  const normalizedOtp = String(otp).trim();
  if (!/^\d{6}$/.test(normalizedOtp)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'OTP must be a 6-digit code.',
    });
  }

  req.body.otp = normalizedOtp;
  next();
};

const validateResetPassword = (req, res, next) => {
  const { reset_token, new_password } = req.body;

  if (!reset_token || String(reset_token).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Reset token is required.',
    });
  }

  const passwordResult = validatePassword(new_password);
  if (!passwordResult.valid) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: passwordResult.message,
    });
  }

  req.body.reset_token = String(reset_token).trim();
  req.body.new_password = String(new_password);
  next();
};

module.exports = {
  validateForgotPasswordEmail,
  validateVerifyForgotPasswordOtp,
  validateResetPassword,
};
