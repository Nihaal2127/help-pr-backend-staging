const User = require('../../../models/user');

const sendAuthError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

/**
 * Rejects JWTs for accounts that were soft-deleted.
 * Does not check is_active: partners can be inactive (unverified) and still signed in.
 */
const rejectIfAccountDeleted = async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  if (!userId) {
    sendAuthError(res, 401, 'Access denied. No token provided.');
    return true;
  }

  const user = await User.findOne({ _id: userId }).select('_id deleted_at').lean();
  if (!user || user.deleted_at) {
    sendAuthError(res, 401, 'This account is no longer available.');
    return true;
  }

  return false;
};

module.exports = {
  sendAuthError,
  rejectIfAccountDeleted,
};
