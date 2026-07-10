const mongoose = require("mongoose");
const OrderService = require("../../../../models/order_services");
const User = require("../../../../models/user");
const { USER_TYPE_ADMIN } = require("../../../../constants/user_types");

const addId = (set, value) => {
  if (value == null || value === "") return;
  set.add(String(value));
};

/**
 * Order notification recipients:
 * - Customer (user_id)
 * - Order-level partner (partner_id) when set
 * - Partners on service lines (service_items)
 * - Assigned employee (employee_id) when set — not all franchise employees
 * - Franchise admin(s) for order.franchise_id
 *
 * The actor who triggered the event is removed later in notification.service.js.
 */
const resolveOrderRecipients = async (order, options = {}) => {
  const {
    includeFranchiseAdmins = true,
    includeAssignedEmployee = true,
    extraUserIds = [],
  } = options;

  const ids = new Set();

  addId(ids, order?.user_id);
  addId(ids, order?.partner_id);
  if (includeAssignedEmployee) {
    addId(ids, order?.employee_id);
  }

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
  resolveOrderRecipients,
};
