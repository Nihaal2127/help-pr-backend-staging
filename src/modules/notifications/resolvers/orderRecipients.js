const mongoose = require("mongoose");
const OrderService = require("../../../../models/order_services");
const User = require("../../../../models/user");
const {
  USER_TYPE_ADMIN,
  USER_TYPE_EMPLOYEE,
} = require("../../../../constants/user_types");

const addId = (set, value) => {
  if (value == null || value === "") return;
  set.add(String(value));
};

const resolveOrderRecipients = async (order, options = {}) => {
  const {
    includeFranchiseAdmins = true,
    includeFranchiseEmployees = true,
    extraUserIds = [],
  } = options;

  const ids = new Set();

  addId(ids, order?.user_id);
  addId(ids, order?.employee_id);
  addId(ids, order?.partner_id);

  const serviceItemIds = order?.service_items || [];
  if (serviceItemIds.length) {
    const objectIds = serviceItemIds
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (objectIds.length) {
      const lines = await OrderService.find({ _id: { $in: objectIds } })
        .select("partner_id")
        .lean();
      lines.forEach((line) => addId(ids, line.partner_id));
    }
  }

  const franchiseId = order?.franchise_id;
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
  resolveOrderRecipients,
};
