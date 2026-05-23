const {
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_IN_PROGRESS,
  ORDER_STATUS_REFUNDED,
  buildRefundedOrderQueryFilter,
  buildOrderManagementStatusQueryFilter,
} = require("../enum/order_status_enum");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const refunded = buildRefundedOrderQueryFilter();
assert(refunded.$or && refunded.$or.length === 2, "refunded filter uses $or");

const completed = buildOrderManagementStatusQueryFilter(ORDER_STATUS_COMPLETED);
assert(completed.$and && completed.$and.length === 2, "completed excludes refund rollups");

const inProgress = buildOrderManagementStatusQueryFilter(ORDER_STATUS_IN_PROGRESS);
assert(inProgress.$and, "in-progress excludes refund rollups");

const refundedList = buildOrderManagementStatusQueryFilter("refund");
assert(refundedList.$or, "refund alias maps to refunded bucket");

const completedOnly = buildOrderManagementStatusQueryFilter(ORDER_STATUS_COMPLETED);
const completedStr = JSON.stringify(completedOnly);
assert(
  completedStr.includes("partially_refund"),
  "completed bucket excludes partially_refund"
);

console.log("verify-order-management-refunded-filter: all checks passed");
