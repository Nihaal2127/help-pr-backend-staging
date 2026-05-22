const {
  computeCustomerPaymentStatus,
  computePartnerPaymentStatus,
} = require("../enum/order_payment_status_enum");

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

// Partner: customer paid 1375, entitlement 1000, partner paid 1000 → cleared
const partnerCleared = computePartnerPaymentStatus(
  1375,
  [{ payer_type: "partner", amount: 1000, status: "completed" }],
  1000
);
assert(
  partnerCleared.partner_payment_status === "paid",
  "partner fully paid when payout matches entitlement"
);
assert(
  partnerCleared.partner_due_amount === 0,
  "partner due zero when entitlement satisfied"
);

// Partner: same order but old logic (no entitlement) would stay partially_paid
const partnerLegacyCap = computePartnerPaymentStatus(
  1375,
  [{ payer_type: "partner", amount: 1000, status: "completed" }]
);
assert(
  partnerLegacyCap.partner_payment_status === "partially_paid",
  "without entitlement cap uses customer_net_paid"
);

// Partner: partial payout
const partnerPartial = computePartnerPaymentStatus(
  1375,
  [{ payer_type: "partner", amount: 500, status: "completed" }],
  1000
);
assert(
  partnerPartial.partner_payment_status === "partially_paid",
  "partner partially paid"
);
assert(partnerPartial.partner_due_amount === 500, "partner due is entitlement minus paid");

// No customer payment yet: partner pending is full entitlement (overview)
const partnerNoCustomer = computePartnerPaymentStatus(
  0,
  [],
  1000
);
assert(
  partnerNoCustomer.partner_payment_status === "unpaid",
  "partner unpaid when nothing paid to partner"
);
assert(
  partnerNoCustomer.partner_due_amount === 1000,
  "partner due is full entitlement before any partner payout"
);

console.log("verify-order-payment-status: all checks passed");
