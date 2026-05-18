const { computeCustomerPaymentStatus } = require("../enum/order_payment_status_enum");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const total = 3712.5;

assert(
  computeCustomerPaymentStatus(total, []).payment_status === "unpaid",
  "no payments"
);

assert(
  computeCustomerPaymentStatus(total, [
    { payer_type: "customer", amount: 3712.5, status: "completed" },
  ]).payment_status === "paid",
  "fully paid"
);

assert(
  computeCustomerPaymentStatus(total, [
    { payer_type: "customer", amount: 2000, status: "completed" },
  ]).payment_status === "partially_paid",
  "partially paid"
);

assert(
  computeCustomerPaymentStatus(total, [
    { payer_type: "customer", amount: 3712.5, status: "completed" },
    { payer_type: "customer", amount: 3712.5, status: "refunded" },
  ]).payment_status === "refund",
  "full refund"
);

assert(
  computeCustomerPaymentStatus(total, [
    { payer_type: "customer", amount: 3712.5, status: "completed" },
    { payer_type: "customer", amount: 1000, status: "refunded" },
  ]).payment_status === "partially_refund",
  "partial refund"
);

console.log("verify-order-payment-status: all checks passed");
