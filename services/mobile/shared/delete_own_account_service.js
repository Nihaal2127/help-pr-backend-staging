const mongoose = require('mongoose');
const User = require('../../../models/user');
const { unregisterAllDeviceTokens } = require('../../device_token_service');
const { fail, okWithMessage } = require('../../../utils/mobile_service_result');
const { USER_TYPE_CUSTOMER, USER_TYPE_PARTNER } = require('../../../constants/user_types');
const {
  safeNotifyBackofficePartnerAccountDeleted,
  safeNotifyBackofficeCustomerAccountDeleted,
} = require('../../../src/modules/notifications/services/backofficeHooks');

const notifyAccountDeleted = (user, expectedType) => {
  const actorUserId = user?._id;
  if (Number(expectedType) === USER_TYPE_PARTNER) {
    void safeNotifyBackofficePartnerAccountDeleted({ partner: user, actorUserId });
    return;
  }
  if (Number(expectedType) === USER_TYPE_CUSTOMER) {
    void safeNotifyBackofficeCustomerAccountDeleted({ customer: user, actorUserId });
  }
};

/**
 * Soft-deletes the authenticated user's own account.
 * Never accepts a target user id from the request; caller must pass JWT userId.
 */
const deleteOwnAccount = async ({ userId, expectedType, notFoundMessage }) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    return fail(401, 'Access denied. No token provided.');
  }

  const user = await User.findOne({
    _id: userId,
    type: expectedType,
  });

  if (!user) {
    return fail(404, notFoundMessage);
  }

  if (user.deleted_at) {
    return fail(400, 'Account is already deleted.');
  }

  const now = new Date();
  const updateResult = await User.updateOne(
    { _id: user._id, type: expectedType, deleted_at: null },
    {
      $set: {
        deleted_at: now,
        updated_at: now,
        is_active: false,
        auth_token: null,
        device_token: null,
      },
    }
  );

  if (!updateResult.matchedCount) {
    return fail(400, 'Account is already deleted.');
  }

  await unregisterAllDeviceTokens(user._id);
  notifyAccountDeleted(user, expectedType);

  return okWithMessage(200, 'Account deleted successfully.');
};

module.exports = { deleteOwnAccount };
