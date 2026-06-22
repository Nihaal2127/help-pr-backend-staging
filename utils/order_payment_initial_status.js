const {
    ORDER_PAYMENT_STATUS_UNPAID,
    PARTNER_PAYMENT_STATUS_UNPAID,
} = require('../enum/order_payment_status_enum');

/** Defaults when pricing is first applied (before any payments). */
const applyInitialPaymentStatusFields = (order, totalPrice = 0) => {
    const due = Number(totalPrice) || 0;
    order.payment_status = ORDER_PAYMENT_STATUS_UNPAID;
    order.user_payment_status = ORDER_PAYMENT_STATUS_UNPAID;
    order.customer_paid_amount = 0;
    order.customer_refunded_amount = 0;
    order.customer_net_paid = 0;
    order.customer_due_amount = due;
    order.is_paid = false;
    order.partner_payment_status = PARTNER_PAYMENT_STATUS_UNPAID;
    order.partner_paid_amount = 0;
    order.partner_due_amount = 0;
};

module.exports = {
    applyInitialPaymentStatusFields,
};
