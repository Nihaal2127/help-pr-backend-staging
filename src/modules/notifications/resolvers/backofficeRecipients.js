const User = require("../../../../models/user");
const Franchise = require("../../../../models/franchise");
const {
  USER_TYPE_ADMIN,
  USER_TYPE_EMPLOYEE,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
} = require("../../../../constants/user_types");

const addId = (set, value) => {
  if (value == null || value === "") return;
  set.add(String(value));
};

const resolveSuperAdminStaffRecipients = async () => {
  const users = await User.find({
    type: { $in: [USER_TYPE_SUPER_ADMIN, USER_TYPE_STAFF] },
    deleted_at: null,
    is_active: true,
  })
    .select("_id")
    .lean();

  return users.map((user) => user._id);
};

const resolveFranchiseBackofficeRecipients = async (franchiseId) => {
  if (!franchiseId) return [];

  const users = await User.find({
    franchise_id: franchiseId,
    type: { $in: [USER_TYPE_ADMIN, USER_TYPE_EMPLOYEE] },
    deleted_at: null,
    is_active: true,
  })
    .select("_id")
    .lean();

  return users.map((user) => user._id);
};

const resolveFranchiseIdFromUserId = async (userId) => {
  if (!userId) return null;
  const user = await User.findById(userId).select("franchise_id").lean();
  return user?.franchise_id || null;
};

const loadFranchiseName = async (franchiseId) => {
  if (!franchiseId) return "";
  const franchise = await Franchise.findById(franchiseId).select("name").lean();
  return franchise?.name || "";
};

const uniqueRecipientIds = (ids) => {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (!id) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
};

const resolveSuperAdminAndFranchiseRecipients = async (franchiseId) => {
  const [superStaff, franchiseUsers] = await Promise.all([
    resolveSuperAdminStaffRecipients(),
    resolveFranchiseBackofficeRecipients(franchiseId),
  ]);
  return uniqueRecipientIds([...superStaff, ...franchiseUsers]);
};

module.exports = {
  resolveSuperAdminStaffRecipients,
  resolveFranchiseBackofficeRecipients,
  resolveFranchiseIdFromUserId,
  loadFranchiseName,
  uniqueRecipientIds,
  resolveSuperAdminAndFranchiseRecipients,
};
