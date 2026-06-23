const { verifyWebhookSignature } = require('./razorpay.service');
const { handleOrderPaymentLinkPaid } = require('./handlers/orderPaymentLink.handler');
const { handleSubscriptionPaymentLinkPaid } = require('./handlers/subscriptionPaymentLink.handler');

/**
 * Process a verified Razorpay webhook payload.
 * @param {object} body - Parsed webhook JSON
 * @returns {Promise<{ ok: boolean, event: string, results: object[] }>}
 */
const dispatchWebhook = async (body) => {
    const event = body.event;
    const results = [];

    if (event !== 'payment_link.paid') {
        return { ok: true, event, results };
    }

    const paymentLinkEntity = body.payload?.payment_link?.entity;
    const paymentEntity = body.payload?.payment?.entity;
    const paymentLinkId = paymentLinkEntity?.id;

    if (!paymentLinkId) {
        return {
            ok: false,
            event,
            results: [{ handled: false, fatal: true, reason: 'missing_payment_link_id' }],
        };
    }

    const paidAmountPaise =
        paymentEntity?.amount != null
            ? Number(paymentEntity.amount)
            : paymentLinkEntity?.amount != null
              ? Number(paymentLinkEntity.amount)
              : null;

    const orderResult = await handleOrderPaymentLinkPaid(paymentLinkId, {
        paymentLinkEntity,
        paidAmountPaise,
        paymentEntity,
    });
    results.push({ type: 'order', ...orderResult });

    if (orderResult.handled) {
        return { ok: true, event, results };
    }

    const subscriptionResult = await handleSubscriptionPaymentLinkPaid(paymentLinkId, {
        paymentLinkEntity,
        paidAmountPaise,
        paymentEntity,
    });
    results.push({ type: 'subscription_change', ...subscriptionResult });

    if (subscriptionResult.handled) {
        return { ok: true, event, results };
    }

    if (subscriptionResult.fatal && subscriptionResult.noRetry) {
        console.error(
            'Subscription payment webhook non-retryable failure:',
            subscriptionResult.reason,
            paymentLinkId
        );
        return { ok: false, event, results, noRetry: true };
    }

    if (subscriptionResult.fatal) {
        return { ok: false, event, results };
    }

    console.warn('No matching order or subscription change for payment link:', paymentLinkId);
    return { ok: false, event, results };
};

module.exports = {
    verifyWebhookSignature,
    dispatchWebhook,
};
