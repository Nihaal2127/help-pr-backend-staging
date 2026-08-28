const User = require('../../../models/user');
const { fail } = require('../../../utils/mobile_service_result');
const {
  normalizeUserEmail,
  normalizeUserPhone,
  getPhoneLookupVariants,
} = require('../../../utils/user_contact_uniqueness');
const { escapeRegExp } = require('../../../utils/string_helpers');

const DELETED_ACCOUNT_MESSAGE =
  'Your account has been deleted, please contact admin or use a different credential';

/**
 * If any of the given credentials belong to a soft-deleted account, returns a fail result.
 * Phone matches are scoped by type when type is provided; email/google/apple are global.
 */
const failIfDeletedAccount = async ({
  phone_number,
  email,
  google_id,
  apple_id,
  type,
} = {}) => {
  const orConditions = [];

  const googleId = google_id != null ? String(google_id).trim() : '';
  if (googleId) {
    orConditions.push({ google_id: googleId });
  }

  const appleId = apple_id != null ? String(apple_id).trim() : '';
  if (appleId) {
    orConditions.push({ apple_id: appleId });
  }

  const normalizedEmail = normalizeUserEmail(email);
  if (normalizedEmail) {
    orConditions.push({
      email: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, 'i'),
    });
  }

  const phoneVariants = getPhoneLookupVariants(normalizeUserPhone(phone_number));
  if (phoneVariants.length > 0) {
    const phoneCondition = { phone_number: { $in: phoneVariants } };
    if (type != null && !Number.isNaN(Number(type))) {
      phoneCondition.type = Number(type);
    }
    orConditions.push(phoneCondition);
  }

  if (orConditions.length === 0) {
    return null;
  }

  const deletedUser = await User.findOne({
    deleted_at: { $ne: null },
    $or: orConditions,
  })
    .select('_id')
    .lean();

  if (!deletedUser) {
    return null;
  }

  return fail(403, DELETED_ACCOUNT_MESSAGE);
};

module.exports = {
  DELETED_ACCOUNT_MESSAGE,
  failIfDeletedAccount,
};
