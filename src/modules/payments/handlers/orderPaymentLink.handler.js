const Order = require('../../../../models/order');
const OrderPayment = require('../../../../models/order_payment');
const { syncOrderPaymentStatus } = require('../../../../services/order_payment_status_service');
const { syncAllPartnerOrderPaymentsForOrder } = require('../../../../services/partner_wallet_order_service');
const { GATEWAY_PAYMENT_METHOD } = require('../constants/payment.constants');

/**
 * Handle payment_link.paid for an order (legacy: order.transaction_id = payment link id).
 * @param {string} paymentLinkId
 */
const handleOrderPaymentLinkPaid = async (paymentLinkId) => {
    const order = await Order.findOne({ transaction_id: paymentLinkId });
    if (!order) {
        return { handled: false, reason: 'order_not_found' };
    }

    const amount = Number(order.total_price) || 0;
    const existing = await OrderPayment.findOne({
        order_id: order._id,
        payer_type: 'customer',
        transaction_reference: paymentLinkId,
        deleted_at: null,
    });

    if (!existing && amount > 0) {
        await OrderPayment.create({
            order_id: order._id,
            payer_type: 'customer',
            amount,
            payment_method: GATEWAY_PAYMENT_METHOD,
            status: 'completed',
            transaction_reference: paymentLinkId,
            paid_at: new Date(),
            notes: 'Razorpay payment link',
        });
    } else if (existing && existing.status !== 'completed') {
        existing.status = 'completed';
        existing.paid_at = new Date();
        existing.updated_at = new Date();
        await existing.save();
    }

    await syncOrderPaymentStatus(order._id);
    await syncAllPartnerOrderPaymentsForOrder(order._id);
    console.log(`Order ${order._id} payment synced from Razorpay`);

    return { handled: true, order_id: order._id };
};

module.exports = {
    handleOrderPaymentLinkPaid,
};
