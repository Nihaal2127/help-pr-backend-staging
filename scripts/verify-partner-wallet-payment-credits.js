/**
 * Sanity checks for payment-based partner wallet rules (no DB).
 * Run: node scripts/verify-partner-wallet-payment-credits.js
 */
const { computeCustomerPaymentStatus } = require('../enum/order_payment_status_enum');

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};

const allocateCredits = (entitlement, customerNetPaid, paymentAmounts) => {
    const ceiling = roundAmount(Math.min(entitlement, customerNetPaid));
    let credited = 0;
    const credits = [];
    for (const amt of paymentAmounts) {
        const remaining = roundAmount(ceiling - credited);
        if (remaining <= 0.01) {
            credits.push(0);
            continue;
        }
        const credit = roundAmount(Math.min(amt, remaining));
        credits.push(credit);
        credited = roundAmount(credited + credit);
    }
    return credits;
};

const customer = computeCustomerPaymentStatus(1000, [
    { payer_type: 'customer', amount: 600, status: 'completed' },
]);
assert(customer.customer_net_paid === 600, 'customer net paid');

const credits = allocateCredits(800, customer.customer_net_paid, [300, 400]);
assert(credits[0] === 300 && credits[1] === 300, 'cap by customer net paid');

const credits2 = allocateCredits(500, 1000, [200, 200, 200]);
assert(credits2[2] === 100, 'cap by order entitlement');

console.log('verify-partner-wallet-payment-credits: OK');
