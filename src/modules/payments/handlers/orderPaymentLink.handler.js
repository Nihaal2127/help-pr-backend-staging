const Order = require('../../../../models/order');
const OrderPayment = require('../../../../models/order_payment');
const Quote = require('../../../../models/quote');
const { GATEWAY_PAYMENT_METHOD, PAYMENT_PURPOSES } = require('../constants/payment.constants');
const {
    findOrderPaymentForPaymentLink,
    completeOrderPaymentFromWebhook,
    finalizeCompletedOrderPaymentSideEffects,
} = require('../services/orderOnlinePayment.service');
const {
    isQuoteDepositPayment,
    completeQuoteDepositFromWebhook,
} = require('../services/quoteDepositPayment.service');
const { recordGatewayPayment } = require('../services/gatewayPayment.service');

/**
 * Handle payment_link.paid for order payments (pending row or legacy order.transaction_id).
 * @param {string} paymentLinkId
 * @param {{ paymentLinkEntity?: object, paidAmountPaise?: number, paymentEntity?: object }} context
 */
const handleOrderPaymentLinkPaid = async (paymentLinkId, context = {}) => {
    const { paymentLinkEntity, paidAmountPaise, paymentEntity } = context;

    const paymentRow = await findOrderPaymentForPaymentLink(paymentLinkId, paymentLinkEntity);

    if (paymentRow) {
        if (isQuoteDepositPayment(paymentRow) || (paymentRow.quote_id && !paymentRow.order_id)) {
            const quote = paymentRow.quote_id
                ? await Quote.findOne({ _id: paymentRow.quote_id, deleted_at: null })
                    .select('user_id')
                    .lean()
                : null;
            const result = await completeQuoteDepositFromWebhook(
                paymentRow._id,
                paymentLinkId,
                paidAmountPaise,
                {
                    gateway_payment_id: paymentEntity?.id || null,
                    instrument_type: paymentEntity?.method || null,
                    paid_at: paymentEntity?.created_at
                        ? new Date(Number(paymentEntity.created_at) * 1000)
                        : new Date(),
                    payer_id: quote?.user_id || null,
                    actor_user_id: quote?.user_id || null,
                }
            );

            if (result.ok) {
                if (result.refunded) {
                    console.log(`Quote deposit payment ${paymentRow._id} refunded (quote invalid)`);
                } else {
                    console.log(`Quote deposit payment ${paymentRow._id} completed from Razorpay`);
                }
                return {
                    handled: true,
                    order_id: result.order_id || null,
                    payment_id: result.payment_id,
                    quote_id: result.quote_id,
                    already_completed: !!result.already_completed,
                    refunded: Boolean(result.refunded),
                };
            }

            console.error('quote deposit webhook completion failed', result.message);
            if ((result.status === 409 || result.status === 400) && !result.retryable) {
                return {
                    handled: false,
                    fatal: true,
                    noRetry: true,
                    reason: result.message,
                    payment_id: paymentRow._id,
                };
            }
            return {
                handled: false,
                fatal: true,
                reason: result.message,
                payment_id: paymentRow._id,
            };
        }

        const order = paymentRow.order_id
            ? await Order.findById(paymentRow.order_id).select('user_id').lean()
            : null;
        const result = await completeOrderPaymentFromWebhook(
            paymentRow._id,
            paymentLinkId,
            paidAmountPaise,
            {
                gateway_payment_id: paymentEntity?.id || null,
                instrument_type: paymentEntity?.method || null,
                paid_at: paymentEntity?.created_at
                    ? new Date(Number(paymentEntity.created_at) * 1000)
                    : new Date(),
                payer_id: order?.user_id || null,
                actor_user_id: order?.user_id || null,
            }
        );

        if (result.ok) {
            console.log(`Order payment ${paymentRow._id} completed from Razorpay`);
            return {
                handled: true,
                order_id: result.order_id,
                payment_id: result.payment_id,
                already_completed: !!result.already_completed,
            };
        }

        console.error('order payment webhook completion failed', result.message);
        if (result.status === 409 || result.status === 400) {
            return {
                handled: false,
                fatal: true,
                noRetry: true,
                reason: result.message,
                payment_id: paymentRow._id,
            };
        }
        return {
            handled: false,
            fatal: true,
            reason: result.message,
            payment_id: paymentRow._id,
        };
    }

    const order = await Order.findOne({ transaction_id: paymentLinkId, deleted_at: null });
    if (!order) {
        return { handled: false, reason: 'order_not_found' };
    }

    const amount = Number(order.total_price) || 0;
    let paymentRowDoc = await OrderPayment.findOne({
        order_id: order._id,
        payer_type: 'customer',
        transaction_reference: paymentLinkId,
        deleted_at: null,
    });

    if (paymentRowDoc && paymentRowDoc.status === 'pending') {
        const result = await completeOrderPaymentFromWebhook(
            paymentRowDoc._id,
            paymentLinkId,
            paidAmountPaise,
            {
                gateway_payment_id: paymentEntity?.id || null,
                instrument_type: paymentEntity?.method || null,
                paid_at: paymentEntity?.created_at
                    ? new Date(Number(paymentEntity.created_at) * 1000)
                    : new Date(),
                payer_id: order.user_id || null,
            }
        );
        if (result.ok) {
            console.log(`Order ${order._id} legacy pending payment completed from Razorpay`);
            return { handled: true, order_id: order._id, legacy: true };
        }
        return {
            handled: false,
            fatal: true,
            reason: result.message || 'legacy_pending_completion_failed',
        };
    }

    if (!paymentRowDoc && amount > 0) {
        paymentRowDoc = await OrderPayment.create({
            order_id: order._id,
            payer_type: 'customer',
            amount,
            payment_method: GATEWAY_PAYMENT_METHOD,
            status: 'completed',
            transaction_reference: paymentEntity?.id || paymentLinkId,
            paid_at: paymentEntity?.created_at
                ? new Date(Number(paymentEntity.created_at) * 1000)
                : new Date(),
            notes: 'Razorpay payment link (legacy admin flow)',
        });
    } else if (paymentRowDoc && paymentRowDoc.status !== 'completed') {
        paymentRowDoc.status = 'completed';
        paymentRowDoc.paid_at = paymentEntity?.created_at
            ? new Date(Number(paymentEntity.created_at) * 1000)
            : new Date();
        paymentRowDoc.transaction_reference = paymentEntity?.id || paymentLinkId;
        paymentRowDoc.updated_at = new Date();
        await paymentRowDoc.save();
    }

    if (paymentRowDoc) {
        await recordGatewayPayment({
            purpose: PAYMENT_PURPOSES.ORDER,
            referenceId: paymentRowDoc._id,
            payerType: 'customer',
            payerId: order.user_id,
            amount: Number(paymentRowDoc.amount) || amount,
            gatewayPaymentLinkId: paymentLinkId,
            gatewayPaymentId: paymentEntity?.id || null,
            instrumentType: paymentEntity?.method || null,
            paidAt: paymentRowDoc.paid_at,
            notes: 'Order payment — Razorpay online payment (legacy admin flow)',
        });

        await finalizeCompletedOrderPaymentSideEffects(order._id, {
            payment: paymentRowDoc,
            notify: true,
        });
    }

    console.log(`Order ${order._id} payment synced from Razorpay (legacy)`);

    return { handled: true, order_id: order._id, legacy: true };
};

module.exports = {
    handleOrderPaymentLinkPaid,
};
