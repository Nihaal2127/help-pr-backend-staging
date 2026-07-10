const mongoose = require('mongoose');
const Quote = require('../../../../models/quote');
const Order = require('../../../../models/order');
const OrderPayment = require('../../../../models/order_payment');
const { OrderCreationError } = require('../../../../errors/order_creation_error');
const { createOrderFromQuote } = require('../../../../services/order_creation_service');
const { resolveQuoteStatus } = require('../../../../enum/quote_status_enum');
const { safeNotifyQuoteStatusChanged } = require('../../notifications/services/domainHooks');
const { createQuoteDepositPaymentLink, fetchPaymentLink } = require('../razorpay.service');
const { createPaymentRefund } = require('../razorpay.client');
const { PAYMENT_PURPOSES, GATEWAY_PAYMENT_METHOD } = require('../constants/payment.constants');
const {
    recordGatewayPayment,
    extractPaymentIdFromLink,
} = require('./gatewayPayment.service');
const {
    finalizeCompletedOrderPaymentSideEffects,
    loadCustomerProfile,
    RAZORPAY_LINK_RESUMABLE,
    RAZORPAY_LINK_TERMINAL_UNPAID,
} = require('./orderOnlinePayment.service');

const PAYMENT_TOLERANCE = 0.01;

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

const isQuoteDepositPayment = (payment) =>
    Boolean(payment?.quote_id) && !payment?.order_id && payment?.status === 'pending';

const findPendingQuoteDepositPayment = async (quoteId) => {
    return OrderPayment.findOne({
        quote_id: quoteId,
        order_id: null,
        payer_type: 'customer',
        payment_method: GATEWAY_PAYMENT_METHOD,
        status: 'pending',
        deleted_at: null,
        transaction_reference: { $gt: '' },
    })
        .sort({ created_at: -1 })
        .lean();
};

const hasPendingQuoteDepositPayment = async (quoteId) => {
    const row = await findPendingQuoteDepositPayment(quoteId);
    return Boolean(row);
};

const markQuoteDepositPaymentFailed = async (paymentId) => {
    return OrderPayment.findOneAndUpdate(
        {
            _id: paymentId,
            status: 'pending',
            deleted_at: null,
            quote_id: { $ne: null },
            order_id: null,
        },
        { $set: { status: 'failed', updated_at: new Date() } },
        { new: true }
    );
};

const assertQuoteReadyForDepositConversion = (quote) => {
    if (!quote) {
        return { ok: false, status: 404, message: 'Quote not found.' };
    }
    if (resolveQuoteStatus(quote) !== 'accepted') {
        return { ok: false, status: 409, message: 'Only accepted quotes can be converted to order.' };
    }
    if (quote.order_id) {
        return { ok: false, status: 409, message: 'Quote is already linked to an order.' };
    }
    return { ok: true };
};

const resolveOrderIdForQuoteDeposit = async (payment, quote = null) => {
    if (payment?.order_id) {
        return payment.order_id;
    }
    if (quote?.order_id) {
        return quote.order_id;
    }
    if (!payment?.quote_id) {
        return null;
    }
    const order = await Order.findOne({
        quote_id: payment.quote_id,
        deleted_at: null,
    })
        .select('_id')
        .lean();
    return order?._id || null;
};

const loadQuoteForDeposit = async (quoteId) =>
    Quote.findOne({ _id: quoteId, deleted_at: null });

const handleInvalidQuotePaidDeposit = async (
    payment,
    paymentLinkId,
    gatewayMeta = {}
) => {
    const gatewayPaymentId = gatewayMeta.gateway_payment_id
        ? String(gatewayMeta.gateway_payment_id).trim()
        : '';

    if (!gatewayPaymentId) {
        return {
            ok: false,
            status: 409,
            message: 'Quote is no longer valid for conversion. Missing gateway payment id for refund.',
            retryable: true,
        };
    }

    const quote = await Quote.findOne({ _id: payment.quote_id, deleted_at: null })
        .select('user_id')
        .lean();
    const payerId = gatewayMeta.payer_id || quote?.user_id || null;
    if (!payerId) {
        return {
            ok: false,
            status: 409,
            message: 'Quote is no longer valid for conversion. Cannot resolve payer for refund.',
            retryable: true,
        };
    }

    const refundAmount = roundAmount(payment.amount);
    try {
        await createPaymentRefund({
            paymentId: gatewayPaymentId,
            amountRupees: refundAmount,
            notes: {
                quote_id: String(payment.quote_id),
                order_payment_id: String(payment._id),
                reason: 'quote_no_longer_accepted',
            },
        });
    } catch (err) {
        const message =
            err?.response?.data?.error?.description ||
            err?.response?.data?.error?.reason ||
            err.message ||
            'Razorpay refund failed.';
        console.error('handleInvalidQuotePaidDeposit refund', {
            paymentId: String(payment._id),
            gatewayPaymentId,
            error: err?.response?.data || err.message,
        });
        return { ok: false, status: 502, message, retryable: true };
    }

    const now = new Date();
    const paidAt = gatewayMeta.paid_at || now;
    const refundedPayment = await OrderPayment.findOneAndUpdate(
        { _id: payment._id, status: 'pending', deleted_at: null },
        {
            $set: {
                status: 'refunded',
                paid_at: paidAt,
                transaction_reference: gatewayPaymentId,
                updated_at: now,
                notes: `${payment.notes || ''} Auto-refunded: quote no longer accepted.`.trim(),
            },
        },
        { new: true }
    );

    if (!refundedPayment) {
        const existing = await OrderPayment.findById(payment._id).lean();
        if (existing?.status === 'refunded') {
            return {
                ok: true,
                refunded: true,
                already_refunded: true,
                payment_id: payment._id,
                quote_id: payment.quote_id,
            };
        }
        return {
            ok: false,
            status: 409,
            message: 'Quote deposit payment could not be marked refunded.',
            retryable: true,
        };
    }

    await recordGatewayPayment({
        purpose: PAYMENT_PURPOSES.ORDER,
        referenceId: payment._id,
        payerType: 'customer',
        payerId,
        amount: refundAmount,
        status: 'refunded',
        gatewayPaymentLinkId: paymentLinkId,
        gatewayPaymentId,
        instrumentType: gatewayMeta.instrument_type || null,
        paidAt,
        notes: 'Quote deposit auto-refund — quote no longer accepted',
    });

    return {
        ok: true,
        refunded: true,
        payment_id: payment._id,
        quote_id: payment.quote_id,
    };
};

const resolveOrCreateOrderForQuoteDeposit = async (payment, quote, gatewayMeta = {}) => {
    let orderId = await resolveOrderIdForQuoteDeposit(payment, quote);

    if (orderId) {
        return { ok: true, orderId };
    }

    const quoteCheck = assertQuoteReadyForDepositConversion(quote);
    if (!quoteCheck.ok) {
        return quoteCheck;
    }

    try {
        const created = await createOrderFromQuote(quote, {
            actorUserId: gatewayMeta.actor_user_id || null,
        });
        return { ok: true, orderId: created.order._id };
    } catch (error) {
        if (error instanceof OrderCreationError) {
            orderId = await resolveOrderIdForQuoteDeposit(payment, quote);
            if (orderId) {
                return { ok: true, orderId };
            }
            return { ok: false, status: error.status, message: error.message, retryable: true };
        }
        throw error;
    }
};

const completeQuoteDepositPaymentRow = async (
    paymentRowId,
    orderId,
    paymentLinkId,
    gatewayMeta = {}
) => {
    const now = new Date();
    const completedPayment = await OrderPayment.findOneAndUpdate(
        {
            _id: paymentRowId,
            status: 'pending',
            deleted_at: null,
        },
        {
            $set: {
                order_id: orderId,
                status: 'completed',
                paid_at: gatewayMeta.paid_at || now,
                transaction_reference: gatewayMeta.gateway_payment_id || paymentLinkId,
                updated_at: now,
            },
        },
        { new: true }
    );

    if (completedPayment) {
        return completedPayment;
    }

    const existing = await OrderPayment.findOne({
        _id: paymentRowId,
        deleted_at: null,
    });

    if (existing?.status === 'completed' && existing.order_id) {
        return existing;
    }

    return null;
};

/**
 * After Razorpay confirms payment: create order from quote, attach order_id, complete payment.
 */
const completeQuoteDepositFromWebhook = async (
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

    if (!payment.quote_id) {
        return { ok: false, status: 400, message: 'Payment is not a quote deposit.' };
    }

    if (
        payment.transaction_reference &&
        payment.transaction_reference !== paymentLinkId &&
        payment.status === 'pending'
    ) {
        return { ok: false, status: 404, message: 'Quote deposit payment link mismatch.' };
    }

    if (payment.status === 'completed' && payment.order_id) {
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
            quote_id: payment.quote_id,
            syncResult,
        };
    }

    if (payment.status === 'refunded') {
        return {
            ok: true,
            already_refunded: true,
            refunded: true,
            payment_id: payment._id,
            quote_id: payment.quote_id,
        };
    }

    if (payment.status !== 'pending') {
        return {
            ok: false,
            status: 409,
            message: `Quote deposit payment is ${payment.status} and cannot be completed.`,
            retryable: false,
        };
    }

    const expectedPaise = Math.round(roundAmount(payment.amount) * 100);
    if (expectedPaise > 0 && paidAmountPaise != null && Number.isFinite(Number(paidAmountPaise))) {
        if (Math.abs(Number(paidAmountPaise) - expectedPaise) > 1) {
            return {
                ok: false,
                status: 400,
                message: `Paid amount mismatch: expected ${expectedPaise} paise, got ${paidAmountPaise}.`,
                retryable: false,
            };
        }
    }

    const quote = await loadQuoteForDeposit(payment.quote_id);
    const quoteStatusBefore = resolveQuoteStatus(quote);

    let orderResolution = await resolveOrCreateOrderForQuoteDeposit(payment, quote, gatewayMeta);

    if (!orderResolution.ok) {
        if (orderResolution.status === 409 || orderResolution.status === 404) {
            return handleInvalidQuotePaidDeposit(payment, paymentLinkId, gatewayMeta);
        }
        return orderResolution;
    }

    const orderId = orderResolution.orderId;
    const completedPayment = await completeQuoteDepositPaymentRow(
        paymentRowId,
        orderId,
        paymentLinkId,
        gatewayMeta
    );

    if (!completedPayment) {
        const existing = await OrderPayment.findById(paymentRowId).lean();
        if (existing?.status === 'completed' && existing.order_id) {
            const syncResult = await finalizeCompletedOrderPaymentSideEffects(existing.order_id, {
                payment: existing,
                actorUserId: gatewayMeta.actor_user_id || null,
                notify: false,
            });
            return {
                ok: true,
                already_completed: true,
                payment_id: existing._id,
                order_id: existing.order_id,
                quote_id: payment.quote_id,
                syncResult,
            };
        }
        return {
            ok: false,
            status: 409,
            message: 'Quote deposit payment could not be completed.',
            retryable: true,
        };
    }

    const orderRow = await Order.findById(orderId).select('user_id').lean();
    const payerId = gatewayMeta.payer_id || orderRow?.user_id || null;

    await recordGatewayPayment({
        purpose: PAYMENT_PURPOSES.ORDER,
        referenceId: completedPayment._id,
        payerType: 'customer',
        payerId,
        amount: roundAmount(completedPayment.amount),
        gatewayPaymentLinkId: paymentLinkId,
        gatewayPaymentId: gatewayMeta.gateway_payment_id || null,
        instrumentType: gatewayMeta.instrument_type || null,
        paidAt: completedPayment.paid_at,
        notes: 'Quote deposit — Razorpay online payment',
    });

    const syncResult = await finalizeCompletedOrderPaymentSideEffects(orderId, {
        payment: completedPayment,
        actorUserId: gatewayMeta.actor_user_id || gatewayMeta.payer_id || payerId || null,
        notify: true,
    });

    const linkedQuote = await Quote.findById(payment.quote_id).lean();
    void safeNotifyQuoteStatusChanged({
        quote: linkedQuote,
        previousStatus: quoteStatusBefore,
        newStatus: resolveQuoteStatus(linkedQuote),
        actorUserId: gatewayMeta.actor_user_id || gatewayMeta.payer_id || payerId || null,
    });

    return {
        ok: true,
        payment_id: completedPayment._id,
        order_id: orderId,
        quote_id: payment.quote_id,
        syncResult,
    };
};

const syncPendingQuoteDepositPayment = async (paymentId) => {
    const payment = await OrderPayment.findOne({
        _id: paymentId,
        deleted_at: null,
    }).lean();

    if (!payment) {
        return { synced: false, reason: 'not_found' };
    }
    if (!payment.quote_id) {
        return { synced: false, reason: 'not_quote_deposit' };
    }
    if (payment.status === 'completed' && payment.order_id) {
        return {
            synced: false,
            reason: 'already_completed',
            order_id: payment.order_id,
        };
    }
    if (payment.status === 'refunded') {
        return { synced: false, reason: 'refunded' };
    }
    if (payment.status !== 'pending' || !payment.transaction_reference) {
        return { synced: false, reason: 'not_pending_online' };
    }

    const linkId = payment.transaction_reference;
    let link;
    try {
        link = await fetchPaymentLink(linkId);
    } catch (err) {
        console.error('syncPendingQuoteDepositPayment fetchPaymentLink', err?.response?.data || err.message);
        return { synced: false, reason: 'razorpay_fetch_failed' };
    }

    if (link.status !== 'paid') {
        return { synced: false, reason: 'not_paid', razorpay_status: link.status };
    }

    const paidAmountPaise =
        link.amount_paid != null ? Number(link.amount_paid) : Number(link.amount);

    const quote = payment.quote_id
        ? await Quote.findOne({ _id: payment.quote_id, deleted_at: null }).select('user_id').lean()
        : null;

    const completion = await completeQuoteDepositFromWebhook(payment._id, linkId, paidAmountPaise, {
        gateway_payment_id: extractPaymentIdFromLink(link),
        instrument_type: link.payments?.[0]?.method || null,
        paid_at: link.updated_at ? new Date(link.updated_at * 1000) : new Date(),
        payer_id: quote?.user_id || null,
        actor_user_id: quote?.user_id || null,
    });

    if (!completion?.ok) {
        return {
            synced: false,
            reason: completion?.refunded ? 'refunded' : 'completion_failed',
            message: completion?.message,
            refunded: Boolean(completion?.refunded),
        };
    }

    return {
        synced: true,
        refunded: Boolean(completion?.refunded),
        payment_id: payment._id,
        order_id: completion.order_id,
        quote_id: payment.quote_id,
        syncResult: completion.syncResult,
    };
};

const tryResumePendingQuoteDepositPayment = async (quoteId, amount) => {
    const pending = await findPendingQuoteDepositPayment(quoteId);
    if (!pending) {
        return { action: 'none' };
    }

    const requestedAmount = roundAmount(amount);
    if (roundAmount(pending.amount) !== requestedAmount) {
        await markQuoteDepositPaymentFailed(pending._id);
        return { action: 'cleared' };
    }

    const sync = await syncPendingQuoteDepositPayment(pending._id);
    if (sync.synced) {
        const row = await OrderPayment.findById(pending._id).lean();
        return { action: 'completed', payment: row, order_id: sync.order_id };
    }
    if (sync.refunded) {
        return { action: 'none' };
    }

    let link;
    try {
        link = await fetchPaymentLink(pending.transaction_reference);
    } catch (err) {
        await markQuoteDepositPaymentFailed(pending._id);
        return { action: 'cleared' };
    }

    if (link.status === 'paid') {
        const retry = await syncPendingQuoteDepositPayment(pending._id);
        if (retry.synced) {
            const row = await OrderPayment.findById(pending._id).lean();
            return { action: 'completed', payment: row, order_id: retry.order_id };
        }
        if (retry.refunded) {
            return { action: 'none' };
        }
        return {
            action: 'blocked',
            message: 'Payment was received but could not be applied. Please contact support.',
        };
    }

    if (RAZORPAY_LINK_TERMINAL_UNPAID.has(link.status)) {
        await markQuoteDepositPaymentFailed(pending._id);
        return { action: 'cleared' };
    }

    if (RAZORPAY_LINK_RESUMABLE.has(link.status)) {
        return {
            action: 'resume',
            payment: pending,
            payment_url: link.short_url,
        };
    }

    await markQuoteDepositPaymentFailed(pending._id);
    return { action: 'cleared' };
};

/**
 * Create pending quote-deposit order_payment + Razorpay link (order created after payment).
 */
const initiateQuoteDepositPayment = async ({
    quote,
    customer,
    amount,
    notes = '',
    actorUserId = null,
}) => {
    const payAmount = roundAmount(amount);
    if (payAmount <= PAYMENT_TOLERANCE) {
        return { ok: false, status: 400, message: 'Payment amount must be greater than zero.' };
    }

    const quoteCheck = assertQuoteReadyForDepositConversion(quote);
    if (!quoteCheck.ok) {
        return quoteCheck;
    }

    const resume = await tryResumePendingQuoteDepositPayment(quote._id, payAmount);
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
            order_id: resume.order_id,
            already_completed: true,
        };
    }
    if (resume.action === 'blocked') {
        return { ok: false, status: 409, message: resume.message };
    }

    const paymentId = new mongoose.Types.ObjectId();
    const linkResult = await createQuoteDepositPaymentLink({
        name: customer.name || 'Customer',
        email: customer.email,
        contact: customer.phone_number,
        amount: payAmount,
        quoteId: quote._id,
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
            quote_id: quote._id,
            payer_type: 'customer',
            amount: payAmount,
            payment_method: GATEWAY_PAYMENT_METHOD,
            status: 'pending',
            transaction_reference: linkResult.payment_link_id || linkResult.transaction_id,
            paid_at: null,
            notes: notes || 'Quote deposit — Razorpay online payment',
            created_at: now,
            updated_at: now,
        },
    ]);

    return {
        ok: true,
        status: 202,
        resumed: false,
        payment: payment.toObject(),
        payment_url: linkResult.payment_url,
        actorUserId,
    };
};

const buildQuoteDepositSummary = (minimumDeposit, amount, collected) => {
    const depositAmount = roundAmount(amount);
    const minimum = roundAmount(minimumDeposit);
    return {
        minimum_deposit_amount: minimum,
        deposit_amount: depositAmount,
        paid_amount: depositAmount,
        remaining_deposit_due: collected
            ? Math.max(0, minimum - depositAmount)
            : minimum,
    };
};

module.exports = {
    loadCustomerProfile,
    isQuoteDepositPayment,
    findPendingQuoteDepositPayment,
    hasPendingQuoteDepositPayment,
    initiateQuoteDepositPayment,
    tryResumePendingQuoteDepositPayment,
    syncPendingQuoteDepositPayment,
    completeQuoteDepositFromWebhook,
    buildQuoteDepositSummary,
};
