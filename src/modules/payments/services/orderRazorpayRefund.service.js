const GatewayPayment = require('../../../../models/gateway_payment');
const OrderPayment = require('../../../../models/order_payment');
const { createPaymentRefund } = require('../razorpay.client');
const { PAYMENT_PURPOSES, GATEWAY_PAYMENT_METHOD } = require('../constants/payment.constants');

const PAYMENT_TOLERANCE = 0.01;

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

const remainingGatewayAmount = (row) =>
    roundAmount(Math.max(0, roundAmount(row.amount) - roundAmount(row.refunded_amount || 0)));

/**
 * Completed Razorpay captures for an order (oldest first), with refundable balance.
 */
const listRefundableGatewayPaymentsForOrder = async (orderId) => {
    const onlinePayments = await OrderPayment.find({
        order_id: orderId,
        payer_type: 'customer',
        payment_method: GATEWAY_PAYMENT_METHOD,
        status: 'completed',
        deleted_at: null,
    })
        .select('_id')
        .lean();

    if (!onlinePayments.length) {
        return [];
    }

    const paymentIds = onlinePayments.map((row) => row._id);

    const gatewayRows = await GatewayPayment.find({
        purpose: PAYMENT_PURPOSES.ORDER,
        reference_id: { $in: paymentIds },
        gateway_payment_id: { $gt: '' },
        deleted_at: null,
        status: { $in: ['completed', 'refunded'] },
    })
        .sort({ paid_at: 1, created_at: 1 })
        .lean();

    return gatewayRows
        .map((row) => ({
            ...row,
            remaining: remainingGatewayAmount(row),
        }))
        .filter((row) => row.remaining > PAYMENT_TOLERANCE);
};

const getRazorpayRefundableBalanceForOrder = async (orderId) => {
    const rows = await listRefundableGatewayPaymentsForOrder(orderId);
    return roundAmount(rows.reduce((sum, row) => sum + row.remaining, 0));
};

/**
 * Call Razorpay refund API and update gateway_payment rows (FIFO across captures).
 * @returns {{ ok: true, refunds: object[], transaction_reference: string } | { ok: false, status: number, message: string }}
 */
const initiateRazorpayRefundsForOrder = async (orderId, refundAmount, { notes = '', orderRefundId = null } = {}) => {
    const amount = roundAmount(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, status: 400, message: 'Refund amount must be positive.' };
    }

    const sources = await listRefundableGatewayPaymentsForOrder(orderId);
    const available = roundAmount(sources.reduce((sum, row) => sum + row.remaining, 0));

    if (available <= PAYMENT_TOLERANCE) {
        return {
            ok: false,
            status: 400,
            message: 'No Razorpay payments available to refund for this order.',
        };
    }

    if (amount > available + PAYMENT_TOLERANCE) {
        return {
            ok: false,
            status: 400,
            message: `Refund amount exceeds Razorpay refundable balance (${available}).`,
        };
    }

    let remaining = amount;
    const refunds = [];

    for (const source of sources) {
        if (remaining <= PAYMENT_TOLERANCE) {
            break;
        }

        const chunk = roundAmount(Math.min(remaining, source.remaining));
        if (chunk <= PAYMENT_TOLERANCE) {
            continue;
        }

        let razorpayRefund;
        try {
            razorpayRefund = await createPaymentRefund({
                paymentId: source.gateway_payment_id,
                amountRupees: chunk,
                notes: {
                    order_id: String(orderId),
                    ...(orderRefundId ? { order_refund_id: String(orderRefundId) } : {}),
                    ...(notes ? { admin_notes: String(notes).slice(0, 200) } : {}),
                },
            });
        } catch (err) {
            const razorpayMessage =
                err?.response?.data?.error?.description ||
                err?.response?.data?.error?.reason ||
                err.message ||
                'Razorpay refund failed.';

            console.error('initiateRazorpayRefundsForOrder', {
                orderId: String(orderId),
                paymentId: source.gateway_payment_id,
                chunk,
                error: err?.response?.data || err.message,
            });

            if (refunds.length > 0) {
                return {
                    ok: false,
                    status: 502,
                    message: `Partial Razorpay refund applied before failure: ${razorpayMessage}`,
                    partial_refunds: refunds,
                };
            }

            return { ok: false, status: 502, message: razorpayMessage };
        }

        const newRefundedTotal = roundAmount(roundAmount(source.refunded_amount || 0) + chunk);
        const fullyRefunded = newRefundedTotal >= roundAmount(source.amount) - PAYMENT_TOLERANCE;

        await GatewayPayment.findOneAndUpdate(
            { _id: source._id, deleted_at: null },
            {
                $set: {
                    refunded_amount: newRefundedTotal,
                    status: fullyRefunded ? 'refunded' : 'completed',
                    updated_at: new Date(),
                },
            }
        );

        refunds.push({
            gateway_payment_id: source.gateway_payment_id,
            razorpay_refund_id: razorpayRefund?.id || '',
            amount: chunk,
        });

        remaining = roundAmount(remaining - chunk);
    }

    const transactionReference = refunds
        .map((row) => row.razorpay_refund_id)
        .filter(Boolean)
        .join(',');

    return {
        ok: true,
        refunds,
        transaction_reference: transactionReference,
        razorpay_refunded_amount: roundAmount(amount - remaining),
    };
};

module.exports = {
    listRefundableGatewayPaymentsForOrder,
    getRazorpayRefundableBalanceForOrder,
    initiateRazorpayRefundsForOrder,
};
