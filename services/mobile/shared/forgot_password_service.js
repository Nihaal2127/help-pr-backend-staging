const User = require('../../../models/user');
const { generateRandomPassword } = require('../../../helper/password_generator');
const { sendEmail } = require('../../../helper/mail');
const { normalizeUserEmail } = require('../../../utils/user_contact_uniqueness');
const {
  USER_TYPE_PARTNER,
  USER_TYPE_CUSTOMER,
} = require('../../../constants/user_types');
const { fail, okWithMessage } = require('../../../utils/mobile_service_result');

const WRONG_APP_MESSAGE_BY_TYPE = {
  [USER_TYPE_PARTNER]: 'This account is not a partner. Use the correct app to sign in.',
  [USER_TYPE_CUSTOMER]: 'This account is not a customer account. Use the correct app to sign in.',
};

const EMAIL_SUBJECT_BY_TYPE = {
  [USER_TYPE_PARTNER]: 'Helper Partner Forgot Password',
  [USER_TYPE_CUSTOMER]: 'Helper Customer Forgot Password',
};

const forgotPasswordByEmail = async ({ email, userType }) => {
  const normalizedEmail = normalizeUserEmail(email);
  const user = await User.findOne({ email: normalizedEmail, deleted_at: null });

  if (!user) {
    return fail(400, 'Invalid credentials.');
  }

  if (Number(user.type) !== Number(userType)) {
    return fail(403, WRONG_APP_MESSAGE_BY_TYPE[userType] || 'Use the correct app to sign in.');
  }

  const password = generateRandomPassword(8);
  user.password = password;
  await user.save();

  const subject = EMAIL_SUBJECT_BY_TYPE[userType] || 'Helper Forgot Password';
  await sendEmail(normalizedEmail, subject, `Your Password For Login is: ${password}`);

  return okWithMessage(200, 'New password sent successfully on your registered mail.');
};

module.exports = {
  forgotPasswordByEmail,
};
