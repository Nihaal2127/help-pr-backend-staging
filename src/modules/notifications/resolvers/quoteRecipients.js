const User = require("../../../../models/user");
const { USER_TYPE_ADMIN } = require("../../../../constants/user_types");

const addId = (set, value) => {
  if (value == null || value === "") return;
  set.add(String(value));
};

/**
 * Quote notification recipients:
 * - Customer (user_id)
 * - Partner (partner_id) — only when a partner is on the quote
 * - Assigned employee (employee_id) — only when set, not all franchise employees
 * - Franchise admin(s) for quote.franchise_id
 * - created_by_id when different from the above
 *
 * The actor who triggered the event is removed later in notification.service.js.
 */
const resolveQuoteRecipients = async (quote, options = {}) => {
  const {
    includeFranchiseAdmins = true,
    includeAssignedEmployee = true,
    extraUserIds = [],
  } = options;

  const ids = new Set();

  addId(ids, quote?.user_id);
  addId(ids, quote?.partner_id);
  if (includeAssignedEmployee) {
    addId(ids, quote?.employee_id);
  }
  addId(ids, quote?.created_by_id);

  const franchiseId = quote?.franchise_id;
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
  resolveQuoteRecipients,
};
