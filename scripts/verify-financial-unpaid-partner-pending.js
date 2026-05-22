const { computePartnerPaymentStatus } = require("../enum/order_payment_status_enum");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const row = {
  customer_net_paid: 0,
  customer_paid_amount: 0,
  customer_due_amount: 1375,
  partner_paid_amount: 0,
  _line_partner_earning: 1000,
  additional_charges_subtotal: 0,
};

const totalPartner = 1000;
const partner = computePartnerPaymentStatus(
  row.customer_net_paid,
  [],
  totalPartner
);

assert(partner.partner_due_amount === 1000, "pending equals entitlement when unpaid");
assert(partner.partner_payment_status === "unpaid", "status unpaid");

console.log("verify-financial-unpaid-partner-pending: OK");
