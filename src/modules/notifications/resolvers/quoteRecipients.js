const User = require("../../../../models/user");
const {
  USER_TYPE_ADMIN,
  USER_TYPE_EMPLOYEE,
} = require("../../../../constants/user_types");

const addId = (set, value) => {
  if (value == null || value === "") return;
  set.add(String(value));
};

const resolveQuoteRecipients = async (quote, options = {}) => {
  const {
    includeFranchiseAdmins = true,
    includeFranchiseEmployees = true,
    extraUserIds = [],
  } = options;

  const ids = new Set();

  addId(ids, quote?.user_id);
  addId(ids, quote?.partner_id);
  addId(ids, quote?.employee_id);
  addId(ids, quote?.created_by_id);

  const franchiseId = quote?.franchise_id;
  if (franchiseId && (includeFranchiseAdmins || includeFranchiseEmployees)) {
    const types = [];
    if (includeFranchiseAdmins) types.push(USER_TYPE_ADMIN);
    if (includeFranchiseEmployees) types.push(USER_TYPE_EMPLOYEE);

    if (types.length) {
      const staff = await User.find({
        franchise_id: franchiseId,
        type: { $in: types },
        deleted_at: null,
        is_active: true,
      })
        .select("_id")
        .lean();
      staff.forEach((user) => addId(ids, user._id));
    }
  }

  extraUserIds.forEach((id) => addId(ids, id));

  return [...ids];
};

module.exports = {
  resolveQuoteRecipients,
};
