/** Razorpay payment link purposes — used in notes and webhook routing. */
const PAYMENT_PURPOSES = {
    ORDER: 'order',
    SUBSCRIPTION_CHANGE: 'subscription_change',
};

/** Stored on order_payment / ledger rows when paid via Razorpay. */
const GATEWAY_PAYMENT_METHOD = 'online';

module.exports = {
    PAYMENT_PURPOSES,
    GATEWAY_PAYMENT_METHOD,
};
