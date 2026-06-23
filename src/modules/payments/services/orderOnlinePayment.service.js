const mongoose = require('mongoose');
const Order = require('../../../../models/order');
const OrderPayment = require('../../../../models/order_payment');
const User = require('../../../../models/user');
const { syncOrderPaymentStatus } = require('../../../../services/order_payment_status_service');
const { syncAllPartnerOrderPaymentsForOrder } = require('../../../../services/partner_wallet_order_service');
const { safeNotifyOrderPaymentReceived } = require('../../notifications/services/domainHooks');
const { createOrderPaymentLink, fetchPaymentLink } = require('../razorpay.service');
const { PAYMENT_PURPOSES, GATEWAY_PAYMENT_METHOD } = require('../constants/payment.constants');
const {
    recordGatewayPayment,
    extractPaymentIdFromLink,
} = require('./gatewayPayment.service');

const PAYMENT_TOLERANCE = 0.01;
const RAZORPAY_LINK_RESUMABLE = new Set(['created', 'issued', 'partially_paid']);
const RAZORPAY_LINK_TERMINAL_UNPAID = new Set(['expired', 'cancelled']);

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

const loadCustomerProfile = async (userId) => {
    const user = await User.findOne({ _id: userId, deleted_at: null })
        .select('_id name email phone_number')
        .lean();
    if (!user) {
        return { ok: false, status: 404, message: 'Customer not found.' };
    }
    if (!user.email && !user.phone_number) {
        return {
            ok: false,
            status: 400,
            message: 'Email or phone number is required on your profile to pay online.',
        };
    }
    return { ok: true, user };
};

const findPendingOnlinePayment = async (orderId, amount = null) => {
    const filter = {
        order_id: orderId,
        payer_type: 'customer',
        payment_method: GATEWAY_PAYMENT_METHOD,
        status: 'pending',
        deleted_at: null,
        transaction_reference: { $gt: '' },
    };
    if (amount != null) {
        filter.amount = roundAmount(amount);
    }
    return OrderPayment.findOne(filter).sort({ created_at: -1 }).lean();
};

const markPaymentFailed = async (paymentId) => {
    await OrderPayment.findOneAndUpdate(
        { _id: paymentId, status: 'pending', deleted_at: null },
        { $set: { status: 'failed', updated_at: new Date() } }
    );
};

/**
 * Recompute order rollups, partner wallet ledger credits, and optional customer notification
 * after a customer order_payment reaches completed (cash, offline, or Razorpay).
 */
const finalizeCompletedOrderPaymentSideEffects = async (
    orderId,
    { payment = null, actorUserId = null, notify = true } = {}
) => {
    const syncResult = await syncOrderPaymentStatus(orderId);
    await syncAllPartnerOrderPaymentsForOrder(orderId);

    if (notify && payment) {
        const order = syncResult?.order || (await Order.findById(orderId).lean());
        void safeNotifyOrderPaymentReceived({
            order,
            payment,
            actorUserId: actorUserId || null,
        });
    }

    return syncResult;
};

/**
 * Complete a pending order payment after Razorpay confirms payment.
 */
const completeOrderPaymentFromWebhook = async (
    paymentRowId,
    paymentLinkId,
    paidAmountPaise = null,
    gatewayMeta = {}
) => {
    const payment = await OrderPayment.findOne({
        _id: paymentRowId,
        deleted_at: null,
    });

    if (!payment) {
        return { ok: false, status: 404, message: 'Order payment not found.' };
    }

    if (
        payment.transaction_reference &&
        payment.transaction_reference !== paymentLinkId &&
        payment.status === 'pending'
    ) {
        return { ok: false, status: 404, message: 'Order payment link mismatch.' };
    }

    if (payment.status === 'completed') {
        const syncResult = await finalizeCompletedOrderPaymentSideEffects(payment.order_id, {
            payment,
            actorUserId: gatewayMeta.actor_user_id || null,
            notify: false,
        });
        return {
            ok: true,
            already_completed: true,
            payment_id: payment._id,
            order_id: payment.order_id,
            syncResult,
        };
    }

    if (payment.status !== 'pending') {
        return {
            ok: false,
            status: 409,
            message: `Order payment is ${payment.status} and cannot be completed.`,
        };
    }

    const expectedPaise = Math.round(roundAmount(payment.amount) * 100);
    if (expectedPaise > 0 && paidAmountPaise != null && Number.isFinite(Number(paidAmountPaise))) {
        if (Math.abs(Number(paidAmountPaise) - expectedPaise) > 1) {
            return {
                ok: false,
                status: 400,
                message: `Paid amount mismatch: expected ${expectedPaise} paise, got ${paidAmountPaise}.`,
            };
        }
    }

    const now = new Date();
    payment.status = 'completed';
    payment.paid_at = gatewayMeta.paid_at || now;
    payment.transaction_reference = gatewayMeta.gateway_payment_id || paymentLinkId;
    payment.updated_at = now;
    await payment.save();

    let payerId = gatewayMeta.payer_id;
    if (!payerId) {
        const orderRow = await Order.findById(payment.order_id).select('user_id').lean();
        payerId = orderRow?.user_id;
    }

    await recordGatewayPayment({
        purpose: PAYMENT_PURPOSES.ORDER,
        referenceId: payment._id,
        payerType: 'customer',
        payerId,
        amount: roundAmount(payment.amount),
        gatewayPaymentLinkId: paymentLinkId,
        gatewayPaymentId: gatewayMeta.gateway_payment_id || null,
        instrumentType: gatewayMeta.instrument_type || null,
        paidAt: payment.paid_at,
        notes: 'Order payment — Razorpay online payment',
    });

    const syncResult = await finalizeCompletedOrderPaymentSideEffects(payment.order_id, {
        payment,
        actorUserId: gatewayMeta.actor_user_id || null,
        notify: true,
    });

    const order = syncResult?.order || (await Order.findById(payment.order_id).lean());

    return {
        ok: true,
        payment_id: payment._id,
        order_id: payment.order_id,
        syncResult,
    };
};

const syncPendingOrderPayment = async (paymentId) => {
    const payment = await OrderPayment.findOne({
        _id: paymentId,
        deleted_at: null,
    }).lean();

    if (!payment) {
        return { synced: false, reason: 'not_found' };
    }
    if (payment.status === 'completed') {
        return { synced: false, reason: 'already_completed' };
    }
    if (payment.status !== 'pending' || !payment.transaction_reference) {
        return { synced: false, reason: 'not_pending_online' };
    }

    const linkId = payment.transaction_reference;
    let link;
    try {
        link = await fetchPaymentLink(linkId);
    } catch (err) {
        console.error('syncPendingOrderPayment fetchPaymentLink', err?.response?.data || err.message);
        return { synced: false, reason: 'razorpay_fetch_failed' };
    }

    if (link.status !== 'paid') {
        return { synced: false, reason: 'not_paid', razorpay_status: link.status };
    }

    const paidAmountPaise =
        link.amount_paid != null ? Number(link.amount_paid) : Number(link.amount);

    const order = await Order.findById(payment.order_id).select('user_id').lean();

    const completion = await completeOrderPaymentFromWebhook(payment._id, linkId, paidAmountPaise, {
        gateway_payment_id: extractPaymentIdFromLink(link),
        instrument_type: link.payments?.[0]?.method || null,
        paid_at: link.updated_at ? new Date(link.updated_at * 1000) : new Date(),
        payer_id: order?.user_id || null,
    });

    if (!completion?.ok) {
        return {
            synced: false,
            reason: 'completion_failed',
            message: completion?.message,
        };
    }

    return { synced: true, payment_id: payment._id, order_id: payment.order_id, syncResult: completion.syncResult };
};

const tryResumePendingOnlineOrderPayment = async (orderId, amount) => {
    const pending = await findPendingOnlinePayment(orderId, amount);
    if (!pending) {
        return { action: 'none' };
    }

    const sync = await syncPendingOrderPayment(pending._id);
    if (sync.synced) {
        const row = await OrderPayment.findById(pending._id).lean();
        return { action: 'completed', payment: row };
    }

    let link;
    try {
        link = await fetchPaymentLink(pending.transaction_reference);
    } catch (err) {
        await markPaymentFailed(pending._id);
        return { action: 'cleared' };
    }

    if (link.status === 'paid') {
        const retry = await syncPendingOrderPayment(pending._id);
        if (retry.synced) {
            const row = await OrderPayment.findById(pending._id).lean();
            return { action: 'completed', payment: row };
        }
        return {
            action: 'blocked',
            message: 'Payment was received but could not be applied. Please contact support.',
        };
    }

    if (RAZORPAY_LINK_TERMINAL_UNPAID.has(link.status)) {
        await markPaymentFailed(pending._id);
        return { action: 'cleared' };
    }

    if (RAZORPAY_LINK_RESUMABLE.has(link.status)) {
        return {
            action: 'resume',
            payment: pending,
            payment_url: link.short_url,
        };
    }

    await markPaymentFailed(pending._id);
    return { action: 'cleared' };
};

/**
 * Create pending order_payment + Razorpay link (or resume existing).
 */
const initiateOnlineOrderPayment = async ({
    order,
    customer,
    amount,
    notes = '',
    installment_index = null,
    due_date = null,
}) => {
    const payAmount = roundAmount(amount);
    if (payAmount <= PAYMENT_TOLERANCE) {
        return { ok: false, status: 400, message: 'Payment amount must be greater than zero.' };
    }

    const resume = await tryResumePendingOnlineOrderPayment(order._id, payAmount);
    if (resume.action === 'resume') {
        return {
            ok: true,
            status: 202,
            resumed: true,
            payment: resume.payment,
            payment_url: resume.payment_url,
        };
    }
    if (resume.action === 'completed') {
        return {
            ok: true,
            status: 200,
            payment: resume.payment,
            already_completed: true,
        };
    }

    const paymentId = new mongoose.Types.ObjectId();
    const linkResult = await createOrderPaymentLink({
        name: customer.name || 'Customer',
        email: customer.email,
        contact: customer.phone_number,
        amount: payAmount,
        orderId: order._id,
        orderPaymentId: paymentId,
    });

    if (!linkResult.success) {
        return {
            ok: false,
            status: 502,
            message: linkResult.error || 'Failed to create Razorpay payment link.',
        };
    }

    const now = new Date();
    const [payment] = await OrderPayment.create([
        {
            _id: paymentId,
            order_id: order._id,
            payer_type: 'customer',
            amount: payAmount,
            payment_method: GATEWAY_PAYMENT_METHOD,
            status: 'pending',
            transaction_reference: linkResult.payment_link_id || linkResult.transaction_id,
            installment_index:
                installment_index !== undefined && installment_index !== null
                    ? Number(installment_index)
                    : null,
            due_date: due_date ? new Date(due_date) : null,
            paid_at: null,
            notes: notes || 'Razorpay payment link',
            created_at: now,
            updated_at: now,
        },
    ]);

    await Order.findByIdAndUpdate(order._id, {
        $set: {
            transaction_id: linkResult.payment_link_id || linkResult.transaction_id,
            customer_payment_method: GATEWAY_PAYMENT_METHOD,
            updated_at: now,
        },
    });

    return {
        ok: true,
        status: 202,
        resumed: false,
        payment: payment.toObject(),
        payment_url: linkResult.payment_url,
    };
};

const findOrderPaymentForPaymentLink = async (paymentLinkId, paymentLinkEntity) => {
    const byLink = await OrderPayment.findOne({
        transaction_reference: paymentLinkId,
        payer_type: 'customer',
        deleted_at: null,
    }).lean();

    if (byLink) {
        return byLink;
    }

    const paymentIdRaw = paymentLinkEntity?.notes?.order_payment_id;
    if (!paymentIdRaw || !mongoose.Types.ObjectId.isValid(String(paymentIdRaw))) {
        return null;
    }

    return OrderPayment.findOne({
        _id: paymentIdRaw,
        deleted_at: null,
    }).lean();
};

module.exports = {
    loadCustomerProfile,
    initiateOnlineOrderPayment,
    tryResumePendingOnlineOrderPayment,
    completeOrderPaymentFromWebhook,
    finalizeCompletedOrderPaymentSideEffects,
    syncPendingOrderPayment,
    findOrderPaymentForPaymentLink,
    RAZORPAY_LINK_RESUMABLE,
};
