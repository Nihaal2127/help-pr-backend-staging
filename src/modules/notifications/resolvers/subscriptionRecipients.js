const User = require("../../../../models/user");
const { USER_TYPE_ADMIN } = require("../../../../constants/user_types");

const addId = (set, value) => {
  if (value == null || value === "") return;
  set.add(String(value));
};

const resolveSubscriptionRecipients = async (subscription, options = {}) => {
  const { includeFranchiseAdmins = true, extraUserIds = [] } = options;
  const ids = new Set();

  const partnerId =
    subscription?.partner_id?._id || subscription?.partner_id || null;
  addId(ids, partnerId);

  const franchiseId =
    subscription?.franchise_id ||
    (partnerId
      ? (
          await User.findById(partnerId).select("franchise_id").lean()
        )?.franchise_id
      : null);

  if (franchiseId && includeFranchiseAdmins) {
    const admins = await User.find({
      franchise_id: franchiseId,
      type: USER_TYPE_ADMIN,
      deleted_at: null,
      is_active: true,
    })
      .select("_id")
      .lean();
    admins.forEach((user) => addId(ids, user._id));
  }

  extraUserIds.forEach((id) => addId(ids, id));

  return [...ids];
};

module.exports = {
  resolveSubscriptionRecipients,
};
