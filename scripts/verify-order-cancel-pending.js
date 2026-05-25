const {
  isOrderStatusWithNoPendingAmounts,
  clearPendingAmountsForTerminalOrder,
  buildTerminalOrderStatusMatchValues,
} = require("../enum/order_status_enum");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

assert(isOrderStatusWithNoPendingAmounts("cancelled"), "cancelled");
assert(isOrderStatusWithNoPendingAmounts("canceled"), "canceled alias");
assert(isOrderStatusWithNoPendingAmounts("refunded"), "refunded");
assert(isOrderStatusWithNoPendingAmounts(4), "legacy cancelled numeric");
assert(!isOrderStatusWithNoPendingAmounts("in-progress"), "in-progress still pending");
assert(!isOrderStatusWithNoPendingAmounts("completed"), "completed still pending");

const order = {
  order_status: "cancelled",
  customer_due_amount: 1500,
  partner_due_amount: 800,
};
clearPendingAmountsForTerminalOrder(order);
assert(order.customer_due_amount === 0, "customer due cleared");
assert(order.partner_due_amount === 0, "partner due cleared");

const active = {
  order_status: "in-progress",
  customer_due_amount: 1500,
  partner_due_amount: 800,
};
clearPendingAmountsForTerminalOrder(active);
assert(active.customer_due_amount === 1500, "active customer due unchanged");
assert(active.partner_due_amount === 800, "active partner due unchanged");

const terminalMatch = buildTerminalOrderStatusMatchValues();
assert(terminalMatch.includes("cancelled"), "terminal match includes cancelled");
assert(terminalMatch.includes("refunded"), "terminal match includes refunded");
assert(terminalMatch.includes(4), "terminal match includes legacy cancelled numeric 4");

console.log("verify-order-cancel-pending: all checks passed");
