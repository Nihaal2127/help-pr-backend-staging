const razorpayClient = require('./razorpay.client');
const { PAYMENT_PURPOSES } = require('./constants/payment.constants');

/**
 * Create a Razorpay payment link for an order.
 */
const createOrderPaymentLink = async ({
    name,
    email,
    contact,
    amount,
    orderId,
    orderPaymentId,
}) => {
    try {
        const notes = {
            purpose: PAYMENT_PURPOSES.ORDER,
            order_id: orderId ? String(orderId) : '',
        };
        if (orderPaymentId) {
            notes.order_payment_id = String(orderPaymentId);
        }

        const link = await razorpayClient.createPaymentLink({
            amount,
            customer: { name, email, contact },
            notes,
            referenceId: orderPaymentId
                ? `order_pay_${orderPaymentId}`
                : orderId
                  ? `order_${orderId}`
                  : undefined,
            description: 'Order payment',
        });

        return {
            success: true,
            payment_url: link.payment_url,
            transaction_id: link.payment_link_id,
            payment_link_id: link.payment_link_id,
        };
    } catch (error) {
        console.error('createOrderPaymentLink', error?.response?.data || error.message);
        return {
            success: false,
            error: error?.response?.data?.error?.description || 'Failed to create payment link',
        };
    }
};

/**
 * Create a Razorpay payment link for a subscription change.
 */
const createSubscriptionChangePaymentLink = async ({
    name,
    email,
    contact,
    amount,
    changeId,
    partnerId,
    planName,
}) => {
    try {
        const link = await razorpayClient.createPaymentLink({
            amount,
            customer: { name, email, contact },
            notes: {
                purpose: PAYMENT_PURPOSES.SUBSCRIPTION_CHANGE,
                change_id: String(changeId),
                partner_id: String(partnerId),
            },
            referenceId: `sub_change_${changeId}`,
            description: planName
                ? `Subscription change — ${planName}`
                : 'Subscription change payment',
        });

        return {
            success: true,
            payment_url: link.payment_url,
            payment_link_id: link.payment_link_id,
        };
    } catch (error) {
        console.error('createSubscriptionChangePaymentLink', error?.response?.data || error.message);
        return {
            success: false,
            error: error?.response?.data?.error?.description || 'Failed to create payment link',
        };
    }
};

/** Backward-compatible wrapper used by order_controller. */
const generatePaymentLink = async (name, email, contact, amount) =>
    createOrderPaymentLink({ name, email, contact, amount });

module.exports = {
    createOrderPaymentLink,
    createSubscriptionChangePaymentLink,
    generatePaymentLink,
    fetchPaymentLink: razorpayClient.fetchPaymentLink,
    verifyWebhookSignature: razorpayClient.verifyWebhookSignature,
    resolveWebhookRawBody: razorpayClient.resolveWebhookRawBody,
    parseWebhookRequest: razorpayClient.parseWebhookRequest,
    PAYMENT_PURPOSES,
};
