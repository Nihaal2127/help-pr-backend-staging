const ALLOWED_CUSTOMER_PAYMENT_METHODS = new Set([
  'cash',
  'upi',
  'card',
  'online',
  'bank_transfer',
  'other',
]);

const ORDER_PAYMENT_STATUSES = new Set(['pending', 'completed', 'failed', 'refunded']);

module.exports = {
  ALLOWED_CUSTOMER_PAYMENT_METHODS,
  ORDER_PAYMENT_STATUSES,
};
