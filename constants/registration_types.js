/** Matches models/user.js registration_type field */
const REGISTRATION_TYPE_OTP = 1;
const REGISTRATION_TYPE_GOOGLE = 2;
const REGISTRATION_TYPE_APPLE = 3;
const REGISTRATION_TYPE_ADMIN = 4;
const REGISTRATION_TYPE_EMAIL_PASSWORD = 5;

const REGISTRATION_TYPE_VALUES = [
  REGISTRATION_TYPE_OTP,
  REGISTRATION_TYPE_GOOGLE,
  REGISTRATION_TYPE_APPLE,
  REGISTRATION_TYPE_ADMIN,
  REGISTRATION_TYPE_EMAIL_PASSWORD,
];

const REGISTRATION_TYPE_LABELS = {
  [REGISTRATION_TYPE_OTP]: 'Mobile OTP',
  [REGISTRATION_TYPE_GOOGLE]: 'Google sign-in',
  [REGISTRATION_TYPE_APPLE]: 'Apple sign-in',
  [REGISTRATION_TYPE_ADMIN]: 'Admin registered',
  [REGISTRATION_TYPE_EMAIL_PASSWORD]: 'Email and password',
};

const isValidRegistrationType = (value) =>
  REGISTRATION_TYPE_VALUES.includes(Number(value));

const getRegistrationTypeLabel = (value) =>
  REGISTRATION_TYPE_LABELS[Number(value)] || '';

/**
 * POST /api/user/create (authenticated) → admin registered.
 * POST /api/user/register-partner (public email/password) → email and password.
 */
const resolveRegistrationTypeForUserCreate = (req) => {
  if (req?.user?.id || req?.user?._id) {
    return REGISTRATION_TYPE_ADMIN;
  }
  return REGISTRATION_TYPE_EMAIL_PASSWORD;
};

module.exports = {
  REGISTRATION_TYPE_OTP,
  REGISTRATION_TYPE_GOOGLE,
  REGISTRATION_TYPE_APPLE,
  REGISTRATION_TYPE_ADMIN,
  REGISTRATION_TYPE_EMAIL_PASSWORD,
  REGISTRATION_TYPE_VALUES,
  REGISTRATION_TYPE_LABELS,
  isValidRegistrationType,
  getRegistrationTypeLabel,
  resolveRegistrationTypeForUserCreate,
};
