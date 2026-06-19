const { normalizeUserEmail } = require('../../../utils/user_contact_uniqueness');

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

module.exports = {
  validateForgotPasswordEmail,
};
