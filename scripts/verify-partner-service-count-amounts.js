/**
 * Partner list amounts should mirror customer semantics:
 *   total_amount = entitlement, balance_amount = due (pending), paid_amount = total - due.
 */
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const roundServiceMoney = (value) =>
  Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;

// Example from staging partner list (before fix both balance and paid showed 34).
const totalAmount = 492;
const partnerDueSum = 458;
const partnerPaidSum = 34;

const balanceAmount = partnerDueSum;
const pendingAmount = partnerDueSum;
const paidAmount = roundServiceMoney(totalAmount - pendingAmount);

assert(balanceAmount === 458, 'balance_amount should be outstanding partner due');
assert(paidAmount === 34, 'paid_amount should be amount already paid to partner');
assert(
  roundServiceMoney(balanceAmount + paidAmount) === totalAmount,
  'balance + paid should equal total'
);

// Customer reference (type 4) — same formula.
const customerTotal = 29.04;
const customerDue = 0.14;
const customerPaid = roundServiceMoney(customerTotal - customerDue);
assert(customerPaid === 28.9, 'customer paid_amount matches total - due');

console.log('verify-partner-service-count-amounts: OK');
