const mongoose = require('mongoose');
const PartnerSubscription = require('../../../models/partner_subscription');
const SubscriptionPlan = require('../../../models/subscription_plan');
const PartnerSubscriptionChange = require('../../../models/partner_subscription_change');
const PartnerWalletLedger = require('../../../models/partner_wallet_ledger');
const User = require('../../../models/user');
const { getWalletAggregatesForPartners } = require('../../partner_payout_service');
const {
    PAYMENT_TOLERANCE,
    roundAmount,
    computeExpiresAt,
    computeProration,
    validateUpgradePaymentSplit,
} = require('../../../utils/subscription_proration');
const { safeNotifyWalletTransaction, safeNotifySubscriptionPlanChanged } = require('../../../src/modules/notifications/services/domainHooks');
const { createSubscriptionChangePaymentLink, fetchPaymentLink } = require('../../../src/modules/payments');
const { PAYMENT_PURPOSES } = require('../../../src/modules/payments/constants/payment.constants');
const {
    recordGatewayPayment,
    extractPaymentIdFromLink,
} = require('../../../src/modules/payments/services/gatewayPayment.service');

const { USER_TYPE_PARTNER } = require('../../../constants/user_types');
/** Pending rows without a Razorpay link id (orphaned initiation). */
const PENDING_ORPHAN_EXPIRY_MS = 5 * 60 * 1000;
/** Online payment pending rows expire after this (Razorpay link validity window). */
const ONLINE_PENDING_EXPIRY_MS = 24 * 60 * 60 * 1000;
const APPLY_CHANGE_MAX_ATTEMPTS = 3;
const DUPLICATE_KEY_LOOKUP_ATTEMPTS = 4;
const DUPLICATE_KEY_LOOKUP_DELAY_MS = 75;

/** Razorpay payment link statuses that still accept payment. */
const RAZORPAY_LINK_RESUMABLE = new Set(['created', 'issued', 'partially_paid']);
const RAZORPAY_LINK_TERMINAL_UNPAID = new Set(['expired', 'cancelled']);

class SubscriptionChangeError extends Error {
    constructor(status, message, details = null) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

const isDuplicateKeyError = (err) =>
    err != null && (err.code === 11000 || err.code === 11001);

const findBlockingPendingChange = async (partnerId, session = null) => {
    const query = PartnerSubscriptionChange.findOne({
        partner_id: partnerId,
        status: 'pending',
        deleted_at: null,
    })
        .select('_id partner_id status created_at applied_at wallet_ledger_credit_id wallet_ledger_debit_id')
        .lean();
    if (session) {
        query.session(session);
    }
    return query;
};

const findBlockingPendingChangeWithRetry = async (partnerId, session = null) => {
    for (let attempt = 0; attempt < DUPLICATE_KEY_LOOKUP_ATTEMPTS; attempt++) {
        const row = await findBlockingPendingChange(partnerId, session);
        if (row) {
            return row;
        }
        if (attempt < DUPLICATE_KEY_LOOKUP_ATTEMPTS - 1) {
            await sleep(DUPLICATE_KEY_LOOKUP_DELAY_MS * (attempt + 1));
        }
    }
    return null;
};

const formatBlockingPendingDetails = (row) => {
    if (!row) return null;
    return {
        change_id: row._id,
        status: row.status,
        created_at: row.created_at,
        applied_at: row.applied_at,
        wallet_ledger_credit_id: row.wallet_ledger_credit_id,
        wallet_ledger_debit_id: row.wallet_ledger_debit_id,
    };
};

const buildInProgressError = async (
    partnerId,
    session = null,
    source = 'active_pending',
    keyDetails = null
) => {
    const blocking = await findBlockingPendingChangeWithRetry(
        partnerId,
        source === 'duplicate_pending_index' || source === 'duplicate_key' ? null : session
    );
    return new SubscriptionChangeError(
        409,
        'A subscription change is already in progress. Please try again shortly.',
        {
            reason: source,
            blocking_change: formatBlockingPendingDetails(blocking),
            retryable: !blocking,
            ...(keyDetails || {}),
        }
    );
};

const resolveDuplicateKeyReason = (err) => {
    const pattern = err?.keyPattern || {};
    if (pattern.razorpay_payment_link_id) {
        return 'duplicate_razorpay_payment_link_id';
    }
    if (pattern.partner_id) {
        return 'duplicate_pending_index';
    }
    if (pattern.order_payment_id) {
        return 'duplicate_wallet_order_payment_index';
    }
    if (pattern.order_id) {
        return 'duplicate_wallet_order_index';
    }
    if (pattern._id) {
        return 'duplicate_change_id';
    }
    return 'duplicate_key';
};

const mapExecutionError = async (err, partnerId, session = null) => {
    if (err instanceof SubscriptionChangeError) {
        return err;
    }
    if (isDuplicateKeyError(err)) {
        const reason = resolveDuplicateKeyReason(err);
        console.warn('subscription change duplicate key', reason, err.keyPattern, err.keyValue);
        if (reason === 'duplicate_razorpay_payment_link_id') {
            return new SubscriptionChangeError(
                500,
                'Subscription change could not be saved due to a payment link index conflict. Please contact support.',
                {
                    reason,
                    key_pattern: err.keyPattern || null,
                    key_value: err.keyValue || null,
                }
            );
        }
        const keyDetails = {
            key_pattern: err.keyPattern || null,
            key_value: err.keyValue || null,
        };
        return buildInProgressError(partnerId, session, reason, keyDetails);
    }
    return err;
};

const isRetryableInProgressError = (err) =>
    err instanceof SubscriptionChangeError &&
    err.status === 409 &&
    (err.details?.reason === 'duplicate_pending_index' ||
        err.details?.reason === 'active_pending' ||
        err.details?.reason === 'subscription_plan_conflict' ||
        err.details?.reason === 'duplicate_key' ||
        err.details?.reason === 'duplicate_wallet_order_payment_index' ||
        err.details?.reason === 'duplicate_wallet_order_index' ||
        err.details?.reason === 'duplicate_change_id') &&
    !err.details?.blocking_change;

const resolveIdempotentApply = async (partnerId, newPlan, proration) => {
    const subscription = await loadActiveSubscription(partnerId);
    if (!subscription) {
        return null;
    }

    const currentPlanRef = subscription.subscription_plan_id;
    const currentPlanId =
        currentPlanRef && typeof currentPlanRef === 'object' ? currentPlanRef._id : currentPlanRef;
    if (!currentPlanId || String(currentPlanId) !== String(newPlan._id)) {
        return null;
    }

    const plan = await resolveCurrentPlan(subscription);
    const recentChange = await PartnerSubscriptionChange.findOne({
        partner_id: partnerId,
        to_plan_id: newPlan._id,
        status: 'completed',
        deleted_at: null,
    })
        .sort({ applied_at: -1, created_at: -1 })
        .lean();
    const walletBalance = await getWalletBalance(partnerId);

    return {
        subscription,
        plan: plan || newPlan,
        recentChange,
        walletBalance,
        proration,
    };
};

const buildApplySuccessResponse = (
    proration,
    paymentValidation,
    txResult,
    walletBalance,
    idempotentChange = null
) => {
    const changeDoc = txResult?.changeDoc || idempotentChange;
    const updatedSubscription = txResult?.updatedSubscription;
    const updatedPlan = txResult?.updatedPlan;

    const subscriptionPayload = updatedSubscription
        ? {
              _id: updatedSubscription._id,
              started_at: updatedSubscription.started_at,
              expires_at: updatedSubscription.expires_at,
              status: updatedSubscription.status,
              plan: formatPlanSummary(updatedPlan),
          }
        : txResult?.currentSubscription
          ? {
                _id: txResult.currentSubscription._id,
                started_at: txResult.currentSubscription.started_at,
                expires_at: txResult.currentSubscription.expires_at,
                status: txResult.currentSubscription.status,
                plan: formatPlanSummary(txResult.currentPlan),
            }
          : {
                _id: idempotentChange?.subscription?._id,
                started_at: idempotentChange?.subscription?.started_at,
                expires_at: idempotentChange?.subscription?.expires_at,
                status: idempotentChange?.subscription?.status,
                plan: formatPlanSummary(idempotentChange?.plan),
            };

    const changePayload = {
        _id: changeDoc?._id || null,
        change_type: proration.change_type,
        amount_to_pay: proration.amount_to_pay,
        wallet_amount: paymentValidation.wallet,
        cash_amount: paymentValidation.cash,
        online_amount: paymentValidation.online ?? 0,
        payment_method: paymentValidation.payment_method,
        payment_status: txResult?.changeDoc?.payment_status || 'completed',
        status: txResult?.changeDoc?.status || 'completed',
    };
    if (proration.change_type === 'downgrade') {
        changePayload.wallet_credit = proration.wallet_credit;
    }
    if (txResult?.payment_url) {
        changePayload.payment_url = txResult.payment_url;
    }
    if (txResult?.resumed) {
        changePayload.resumed = true;
    }

    const isPendingOnline =
        txResult?.changeDoc?.status === 'pending' && Boolean(txResult?.payment_url);

    return ok(isPendingOnline ? 202 : 200, {
        message: isPendingOnline
            ? txResult?.resumed
                ? 'Continue your pending payment to complete the subscription change.'
                : 'Complete payment to apply your subscription change.'
            : proration.change_type === 'downgrade'
              ? 'Subscription downgraded successfully.'
              : 'Subscription upgraded successfully.',
        data: {
            subscription: subscriptionPayload,
            change: changePayload,
            wallet_balance: walletBalance,
        },
    });
};

const endMongoSession = async (session) => {
    if (!session) return;
    try {
        await session.endSession();
    } catch (endErr) {
        console.error('subscription change session end', endErr.message);
    }
};

const resolveChangePaymentStatus = (amountToPay) =>
    roundAmount(amountToPay) > 0 ? 'completed' : 'not_required';

const releaseStalePendingChanges = async (partnerId, session = null) => {
    const orphanCutoff = new Date(Date.now() - PENDING_ORPHAN_EXPIRY_MS);
    const onlineCutoff = new Date(Date.now() - ONLINE_PENDING_EXPIRY_MS);

    const findQuery = PartnerSubscriptionChange.find({
        partner_id: partnerId,
        status: 'pending',
        deleted_at: null,
        applied_at: null,
        $or: [
            {
                $or: [{ razorpay_payment_link_id: null }, { razorpay_payment_link_id: '' }],
                created_at: { $lt: orphanCutoff },
            },
            {
                razorpay_payment_link_id: { $gt: '' },
                created_at: { $lt: onlineCutoff },
            },
        ],
    }).select('_id wallet_ledger_debit_id partner_id wallet_amount');
    if (session) {
        findQuery.session(session);
    }
    const staleRows = await findQuery.lean();

    if (!staleRows.length) {
        return 0;
    }

    let expiredCount = 0;
    for (const row of staleRows) {
        const expired = await expirePendingChangeRow(row, session);
        if (expired) {
            expiredCount += 1;
        }
    }

    return expiredCount;
};

const expirePendingChangeRow = async (row, session = null) => {
    const now = new Date();
    const updateQuery = PartnerSubscriptionChange.findOneAndUpdate(
        {
            _id: row._id,
            status: 'pending',
            deleted_at: null,
        },
        {
            $set: {
                status: 'expired',
                payment_status: 'failed',
                updated_at: now,
            },
        },
        { new: true }
    );
    if (session) {
        updateQuery.session(session);
    }
    const updated = await updateQuery.lean();

    if (!updated) {
        return false;
    }

    if (updated.wallet_ledger_debit_id && updated.wallet_amount > 0) {
        await reverseWalletDebitForChange(updated, session);
    }

    return true;
};

const pendingOnlineAmount = (row) =>
    roundAmount(Math.max(0, row.amount_to_pay - row.wallet_amount - row.cash_amount));

const pendingMatchesOnlineRequest = (
    pending,
    { currentPlan, newPlan, proration, paymentValidation }
) => {
    if (String(pending.to_plan_id) !== String(newPlan._id)) {
        return false;
    }
    if (String(pending.from_plan_id) !== String(currentPlan._id)) {
        return false;
    }
    if (Math.abs(pending.amount_to_pay - proration.amount_to_pay) > PAYMENT_TOLERANCE) {
        return false;
    }
    if (Math.abs(pending.wallet_amount - paymentValidation.wallet) > PAYMENT_TOLERANCE) {
        return false;
    }
    if (Math.abs(pendingOnlineAmount(pending) - paymentValidation.online) > PAYMENT_TOLERANCE) {
        return false;
    }
    return true;
};

const buildCompletedOnlineTxResult = async (changeId, partnerId) => {
    const changeDoc = await PartnerSubscriptionChange.findById(changeId).lean();
    const updatedSubscription = await loadActiveSubscription(partnerId);
    const updatedPlan = updatedSubscription ? await resolveCurrentPlan(updatedSubscription) : null;
    return {
        changeDoc,
        updatedSubscription,
        updatedPlan,
    };
};

/**
 * Mobile UX: user backed out of Razorpay and tapped Pay again.
 * Resume the same unpaid link, complete if already paid, or clear stale/conflicting pending rows.
 */
const tryResumeOrClearPendingOnlineChange = async ({
    partner,
    subscription,
    currentPlan,
    newPlan,
    proration,
    paymentValidation,
}) => {
    const pending = await PartnerSubscriptionChange.findOne({
        partner_id: partner._id,
        status: 'pending',
        deleted_at: null,
    }).lean();

    if (!pending) {
        return { action: 'none' };
    }

    if (!pending.razorpay_payment_link_id) {
        await expirePendingChangeRow(pending);
        return { action: 'cleared' };
    }

    const sync = await syncPendingOnlineChangePayment(pending._id, partner._id);
    if (sync.synced) {
        return {
            action: 'completed',
            txResult: await buildCompletedOnlineTxResult(pending._id, partner._id),
        };
    }

    let link;
    try {
        link = await fetchPaymentLink(pending.razorpay_payment_link_id);
    } catch (err) {
        console.error('tryResumeOrClearPendingOnlineChange fetchPaymentLink', err?.response?.data || err.message);
        await expirePendingChangeRow(pending);
        return { action: 'cleared' };
    }

    if (link.status === 'paid') {
        const retrySync = await syncPendingOnlineChangePayment(pending._id, partner._id);
        if (retrySync.synced) {
            return {
                action: 'completed',
                txResult: await buildCompletedOnlineTxResult(pending._id, partner._id),
            };
        }
        return {
            action: 'blocked',
            message:
                'Your payment was received but the subscription could not be updated. Please contact support.',
        };
    }

    if (RAZORPAY_LINK_TERMINAL_UNPAID.has(link.status)) {
        await expirePendingChangeRow(pending);
        return { action: 'cleared' };
    }

    if (!pendingMatchesOnlineRequest(pending, {
        currentPlan,
        newPlan,
        proration,
        paymentValidation,
    })) {
        if (RAZORPAY_LINK_RESUMABLE.has(link.status)) {
            await expirePendingChangeRow(pending);
            return { action: 'cleared' };
        }
        return {
            action: 'blocked',
            message:
                'A different subscription payment is in progress. Complete or cancel it before starting a new one.',
            details: { change_id: pending._id },
        };
    }

    if (RAZORPAY_LINK_RESUMABLE.has(link.status)) {
        return {
            action: 'resume',
            txResult: {
                changeDoc: pending,
                payment_url: link.short_url,
                currentSubscription: subscription,
                currentPlan,
                resumed: true,
            },
        };
    }

    await expirePendingChangeRow(pending);
    return { action: 'cleared' };
};

const { fail, ok } = require('../../../utils/mobile_service_result');

const parseObjectId = (raw, fieldName = 'id') => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!s || !/^[a-fA-F0-9]{24}$/.test(s)) {
        return { ok: false, message: `${fieldName} must be a valid ObjectId.` };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const parsePagination = (query, defaultLimit = 10, maxLimit = 50) => {
    let page = parseInt(query.page, 10);
    let limit = parseInt(query.limit, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
    if (limit > maxLimit) limit = maxLimit;
    return { page, limit, skip: (page - 1) * limit };
};

const loadPartnerUser = async (partnerOid) =>
    User.findOne({
        _id: partnerOid,
        type: USER_TYPE_PARTNER,
        deleted_at: null,
    })
        .select('_id name email phone_number franchise_id verification_status is_blocked')
        .lean();

const assertPartnerAccount = (partner) => {
    if (!partner) {
        return fail(403, 'Only partner accounts can access this resource.');
    }
    return null;
};

const assertEligibleForChange = (partner) => {
    const accountError = assertPartnerAccount(partner);
    if (accountError) return accountError;
    if (partner.is_blocked === true) {
        return fail(403, 'Your account is blocked. Please contact support.');
    }
    if (Number(partner.verification_status) !== 2) {
        return fail(
            403,
            'Subscription changes are available after your account is verified and approved.'
        );
    }
    return null;
};

const loadActivePlan = async (planOid) =>
    SubscriptionPlan.findOne({
        _id: planOid,
        deleted_at: null,
        is_active: true,
    }).lean();

const resolveCurrentPlan = async (subscription) => {
    if (
        subscription.subscription_plan_id &&
        typeof subscription.subscription_plan_id === 'object'
    ) {
        const plan = subscription.subscription_plan_id;
        if (plan.deleted_at != null) {
            return null;
        }
        return plan;
    }
    if (!subscription.subscription_plan_id) {
        return null;
    }
    return SubscriptionPlan.findOne({
        _id: subscription.subscription_plan_id,
        deleted_at: null,
    }).lean();
};

const loadActiveSubscription = async (partnerOid) => {
    const now = new Date();
    return PartnerSubscription.findOne({
        partner_id: partnerOid,
        status: 'active',
        deleted_at: null,
        $or: [{ expires_at: null }, { expires_at: { $gt: now } }],
    })
        .sort({ updated_at: -1, created_at: -1 })
        .populate('subscription_plan_id')
        .lean();
};

const getWalletBalance = async (partnerOid, session = null) => {
    if (session) {
        return getWalletBalanceInSession(partnerOid, session);
    }
    const map = await getWalletAggregatesForPartners([partnerOid]);
    const row = map.get(String(partnerOid));
    return row ? roundAmount(row.total_wallet_amount) : 0;
};

const getWalletBalanceInSession = async (partnerOid, session) => {
    const rows = await PartnerWalletLedger.aggregate([
        {
            $match: {
                partner_id: new mongoose.Types.ObjectId(String(partnerOid)),
                deleted_at: null,
            },
        },
        {
            $group: {
                _id: null,
                total_credit: {
                    $sum: {
                        $cond: [{ $eq: ['$transaction_type', 'credit'] }, '$amount', 0],
                    },
                },
                total_debit: {
                    $sum: {
                        $cond: [{ $eq: ['$transaction_type', 'debit'] }, '$amount', 0],
                    },
                },
            },
        },
    ]).session(session);

    const credit = rows[0]?.total_credit ?? 0;
    const debit = rows[0]?.total_debit ?? 0;
    return roundAmount(credit - debit);
};

const formatPlanSummary = (plan) => {
    if (!plan) {
        return null;
    }
    return {
        _id: plan._id,
        plan_name: plan.plan_name,
        plan_description: plan.plan_description,
        price: plan.price,
        duration: plan.duration,
        duration_type: plan.duration_type,
        priority: plan.priority,
    };
};

const formatChangeRecord = (row) => ({
    _id: row._id,
    change_type: row.change_type,
    from_plan: formatPlanSummary(row.from_plan_id),
    to_plan: formatPlanSummary(row.to_plan_id),
    days_used: row.days_used,
    days_total: row.days_total,
    consumed_value: row.consumed_value,
    remaining_value: row.remaining_value,
    amount_to_pay: row.amount_to_pay,
    wallet_amount: row.wallet_amount,
    cash_amount: row.cash_amount,
    wallet_credit: row.wallet_credit,
    payment_method: row.payment_method,
    status: row.status,
    applied_at: row.applied_at,
    created_at: row.created_at,
});

const buildChangeContext = async (partnerId, targetPlanId) => {
    const pPartner = parseObjectId(partnerId, 'partner_id');
    if (!pPartner.ok) return fail(400, pPartner.message);

    const pTarget = parseObjectId(targetPlanId, 'target_plan_id');
    if (!pTarget.ok) return fail(400, pTarget.message);

    const partner = await loadPartnerUser(pPartner.oid);
    const eligibilityError = assertEligibleForChange(partner);
    if (eligibilityError) return eligibilityError;

    const subscription = await loadActiveSubscription(pPartner.oid);
    if (!subscription || !subscription.subscription_plan_id) {
        return fail(404, 'No active subscription found.');
    }

    const currentPlan = await resolveCurrentPlan(subscription);
    if (!currentPlan) {
        return fail(404, 'Current subscription plan is not available.');
    }

    const newPlan = await loadActivePlan(pTarget.oid);
    if (!newPlan) {
        return fail(404, 'Target subscription plan not found, inactive, or deleted.');
    }

    const proration = computeProration({
        currentPlan,
        newPlan,
        startedAt: subscription.started_at,
    });

    if (proration.change_type === 'same') {
        return fail(400, 'You are already on this subscription plan.');
    }
    if (proration.change_type === 'lateral') {
        return fail(400, 'This plan change is not allowed.');
    }

    return ok(200, {
        partner,
        subscription,
        currentPlan,
        newPlan,
        proration,
    });
};

const getSubscriptionSummary = async (partnerId) => {
    try {
        const pPartner = parseObjectId(partnerId, 'partner_id');
        if (!pPartner.ok) return fail(400, pPartner.message);

        const partner = await loadPartnerUser(pPartner.oid);
        const accountError = assertPartnerAccount(partner);
        if (accountError) return accountError;

        const subscription = await loadActiveSubscription(pPartner.oid);
        const walletBalance = await getWalletBalance(pPartner.oid);

        if (!subscription) {
            return ok(200, {
                message: 'No active subscription found.',
                data: {
                    subscription: null,
                    wallet_balance: walletBalance,
                    days_used: 0,
                    days_total: 0,
                },
            });
        }

        const plan = await resolveCurrentPlan(subscription);
        const proration = plan
            ? computeProration({
                  currentPlan: plan,
                  newPlan: plan,
                  startedAt: subscription.started_at,
              })
            : { days_used: 0, days_total: 0 };

        return ok(200, {
            message: 'Partner subscription fetched successfully.',
            data: {
                subscription: {
                    _id: subscription._id,
                    started_at: subscription.started_at,
                    expires_at: subscription.expires_at,
                    status: subscription.status,
                    plan: formatPlanSummary(plan),
                },
                wallet_balance: walletBalance,
                days_used: proration.days_used,
                days_total: proration.days_total,
            },
        });
    } catch (err) {
        console.error('getSubscriptionSummary', err.message);
        return fail(500, 'Internal server error.');
    }
};

const previewChange = async (partnerId, targetPlanId) => {
    try {
        const ctx = await buildChangeContext(partnerId, targetPlanId);
        if (!ctx.ok) return ctx;

        const { currentPlan, newPlan, proration } = ctx.data;
        const walletBalance = await getWalletBalance(ctx.data.partner._id);

        return ok(200, {
            message: 'Subscription change preview generated successfully.',
            data: {
                change_type: proration.change_type,
                current_plan: formatPlanSummary(currentPlan),
                target_plan: formatPlanSummary(newPlan),
                days_used: proration.days_used,
                days_total: proration.days_total,
                days_remaining: proration.days_remaining,
                daily_rate: proration.daily_rate,
                consumed_value: proration.consumed_value,
                remaining_value: proration.remaining_value,
                gross_new_plan_price: proration.gross_new_plan_price,
                amount_to_pay: proration.amount_to_pay,
                wallet_credit: proration.wallet_credit,
                new_period_days: proration.new_period_days,
                new_expires_at: proration.new_expires_at,
                wallet_balance: walletBalance,
            },
        });
    } catch (err) {
        console.error('previewChange', err.message);
        return fail(500, 'Internal server error.');
    }
};

const listChangeHistory = async (partnerId, query = {}) => {
    try {
        const pPartner = parseObjectId(partnerId, 'partner_id');
        if (!pPartner.ok) return fail(400, pPartner.message);

        const partner = await loadPartnerUser(pPartner.oid);
        const accountError = assertPartnerAccount(partner);
        if (accountError) return accountError;

        const { page, limit, skip } = parsePagination(query);
        const filter = {
            partner_id: pPartner.oid,
            status: 'completed',
            deleted_at: null,
        };

        const [records, totalCount] = await Promise.all([
            PartnerSubscriptionChange.find(filter)
                .populate('from_plan_id', 'plan_name price duration duration_type priority')
                .populate('to_plan_id', 'plan_name price duration duration_type priority')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            PartnerSubscriptionChange.countDocuments(filter),
        ]);

        const totalPages = Math.ceil(totalCount / limit) || 0;

        return ok(200, {
            message: 'Subscription change history fetched successfully.',
            data: {
                totalItems: totalCount,
                totalPages,
                currentPage: page,
                limit,
                records: records.map(formatChangeRecord),
            },
        });
    } catch (err) {
        console.error('listChangeHistory', err.message);
        return fail(500, 'Internal server error.');
    }
};

const applySubscriptionUpdate = async (
    subscriptionId,
    newPlanId,
    expectedCurrentPlanId,
    asOf,
    session
) => {
    const plan = await SubscriptionPlan.findById(newPlanId).session(session).lean();
    if (!plan) {
        throw new SubscriptionChangeError(404, 'Target subscription plan not found.');
    }
    const endDate = computeExpiresAt(asOf, plan);

    const filter = {
        _id: subscriptionId,
        deleted_at: null,
        status: 'active',
        subscription_plan_id: expectedCurrentPlanId,
    };

    const updated = await PartnerSubscription.findOneAndUpdate(
        filter,
        {
            $set: {
                subscription_plan_id: newPlanId,
                started_at: asOf,
                expires_at: endDate,
                status: 'active',
                updated_at: asOf,
            },
        },
        { new: true, session }
    ).lean();

    if (!updated) {
        throw new SubscriptionChangeError(
            409,
            'Subscription plan changed before update could be applied. Please retry.',
            { reason: 'subscription_plan_conflict' }
        );
    }

    return { updated, plan };
};

const createWalletLedgerEntry = async (
    {
        partnerId,
        franchiseId,
        transactionType,
        amount,
        description,
        paymentMethod,
        subscriptionChangeId,
    },
    session
) => {
    const now = new Date();
    const ledgerDoc = {
        partner_id: partnerId,
        franchise_id: franchiseId || null,
        transaction_type: transactionType,
        amount: roundAmount(amount),
        date: now,
        description: String(description).trim(),
        payment_method: paymentMethod || null,
        created_at: now,
        updated_at: now,
    };
    if (subscriptionChangeId) {
        ledgerDoc.subscription_change_id = subscriptionChangeId;
    }
    // Omit order_id / order_payment_id — null values collide on DocumentDB legacy unique indexes.
    const [row] = await PartnerWalletLedger.create([ledgerDoc], { session });
    void safeNotifyWalletTransaction({
        ledgerEntry: row,
        actorUserId: null,
    });
    return row;
};

const reverseWalletDebitForChange = async (changeRow, session = null) => {
    const partnerId = changeRow.partner_id;
    const amount = roundAmount(changeRow.wallet_amount);
    if (amount <= 0) {
        return null;
    }

    const partner = await User.findById(partnerId)
        .select('_id franchise_id')
        .session(session || null)
        .lean();
    if (!partner) {
        return null;
    }

    return createWalletLedgerEntry(
        {
            partnerId: partner._id,
            franchiseId: partner.franchise_id,
            transactionType: 'credit',
            amount,
            description: 'Subscription change payment expired — wallet refund',
            paymentMethod: 'subscription_refund',
            subscriptionChangeId: changeRow._id,
        },
        session
    );
};

const executeChangeInTransaction = async ({
    partner,
    subscription,
    currentPlan,
    newPlan,
    proration,
    paymentValidation,
}) => {
    const session = await mongoose.startSession();
    let result;

    try {
        await session.withTransaction(async () => {
            await releaseStalePendingChanges(partner._id, session);

            const pending = await findBlockingPendingChange(partner._id, session);
            if (pending) {
                throw await buildInProgressError(partner._id, session, 'active_pending');
            }

            const now = new Date();

            if (proration.amount_to_pay > 0) {
                const freshBalance = await getWalletBalance(partner._id, session);
                const revalidated = validateUpgradePaymentSplit({
                    amountToPay: proration.amount_to_pay,
                    walletAmount: paymentValidation.wallet,
                    cashAmount: paymentValidation.cash,
                    onlineAmount: paymentValidation.online ?? 0,
                    walletBalance: freshBalance,
                });
                if (!revalidated.ok) {
                    throw new SubscriptionChangeError(400, revalidated.message);
                }
                paymentValidation.wallet = revalidated.wallet;
                paymentValidation.cash = revalidated.cash;
                paymentValidation.online = revalidated.online;
                paymentValidation.payment_method = revalidated.payment_method;

                if (revalidated.online > PAYMENT_TOLERANCE) {
                    throw new SubscriptionChangeError(
                        400,
                        'Online payment must use the online_amount flow, not immediate apply.'
                    );
                }
            }

            const changeId = new mongoose.Types.ObjectId();
            let walletLedgerDebitId = null;
            let walletLedgerCreditId = null;

            if (proration.change_type === 'downgrade' && proration.wallet_credit > 0) {
                const creditRow = await createWalletLedgerEntry(
                    {
                        partnerId: partner._id,
                        franchiseId: partner.franchise_id,
                        transactionType: 'credit',
                        amount: proration.wallet_credit,
                        description: `Subscription downgrade credit (${currentPlan.plan_name} to ${newPlan.plan_name})`,
                        paymentMethod: 'subscription_downgrade',
                        subscriptionChangeId: changeId,
                    },
                    session
                );
                walletLedgerCreditId = creditRow._id;
            }

            if (paymentValidation.wallet > 0) {
                const debitLabel =
                    proration.change_type === 'downgrade' ? 'downgrade payment' : 'upgrade payment';
                const debitRow = await createWalletLedgerEntry(
                    {
                        partnerId: partner._id,
                        franchiseId: partner.franchise_id,
                        transactionType: 'debit',
                        amount: paymentValidation.wallet,
                        description: `Subscription ${debitLabel} (${currentPlan.plan_name} to ${newPlan.plan_name})`,
                        paymentMethod: 'wallet',
                        subscriptionChangeId: changeId,
                    },
                    session
                );
                walletLedgerDebitId = debitRow._id;
            }

            const { updated, plan: updatedPlan } = await applySubscriptionUpdate(
                subscription._id,
                newPlan._id,
                currentPlan._id,
                now,
                session
            );

            const [completedChange] = await PartnerSubscriptionChange.create(
                [
                    {
                        _id: changeId,
                        partner_id: partner._id,
                        from_plan_id: currentPlan._id,
                        to_plan_id: newPlan._id,
                        change_type: proration.change_type,
                        days_used: proration.days_used,
                        days_total: proration.days_total,
                        consumed_value: proration.consumed_value,
                        remaining_value: proration.remaining_value,
                        gross_new_plan_price: proration.gross_new_plan_price,
                        amount_to_pay: proration.amount_to_pay,
                        wallet_amount: paymentValidation.wallet,
                        cash_amount: paymentValidation.cash,
                        wallet_credit: proration.wallet_credit,
                        payment_method: paymentValidation.payment_method,
                        payment_status: resolveChangePaymentStatus(proration.amount_to_pay),
                        status: 'completed',
                        applied_at: now,
                        wallet_ledger_debit_id: walletLedgerDebitId,
                        wallet_ledger_credit_id: walletLedgerCreditId,
                        razorpay_payment_link_id: null,
                        transaction_reference: null,
                        created_at: now,
                        updated_at: now,
                    },
                ],
                { session }
            );

            result = {
                changeDoc: completedChange.toObject(),
                updatedSubscription: updated,
                updatedPlan,
            };
        });
    } catch (err) {
        throw await mapExecutionError(err, partner._id, session);
    } finally {
        await endMongoSession(session);
    }

    if (!result) {
        throw new SubscriptionChangeError(500, 'Subscription change could not be completed.');
    }

    if (result.updatedSubscription && result.updatedPlan) {
        void safeNotifySubscriptionPlanChanged({
            subscription: result.updatedSubscription,
            planName: result.updatedPlan.plan_name,
            paymentCompleted: false,
            actorUserId: partner._id,
        });
    }

    return result;
};

const initiateOnlineChangeInTransaction = async ({
    partner,
    subscription,
    currentPlan,
    newPlan,
    proration,
    paymentValidation,
}) => {
    const changeId = new mongoose.Types.ObjectId();

    const paymentLink = await createSubscriptionChangePaymentLink({
        name: partner.name || 'Partner',
        email: partner.email,
        contact: partner.phone_number,
        amount: paymentValidation.online,
        changeId,
        partnerId: partner._id,
        planName: newPlan.plan_name,
    });

    if (!paymentLink.success) {
        throw new SubscriptionChangeError(
            502,
            paymentLink.error || 'Failed to create Razorpay payment link.'
        );
    }

    const session = await mongoose.startSession();
    let pendingChange = null;

    try {
        await session.withTransaction(async () => {
            await releaseStalePendingChanges(partner._id, session);

            const blocking = await findBlockingPendingChange(partner._id, session);
            if (blocking) {
                throw await buildInProgressError(partner._id, session, 'active_pending');
            }

            const now = new Date();
            const freshBalance = await getWalletBalance(partner._id, session);
            const revalidated = validateUpgradePaymentSplit({
                amountToPay: proration.amount_to_pay,
                walletAmount: paymentValidation.wallet,
                cashAmount: paymentValidation.cash,
                onlineAmount: paymentValidation.online ?? 0,
                walletBalance: freshBalance,
            });
            if (!revalidated.ok) {
                throw new SubscriptionChangeError(400, revalidated.message);
            }
            if (revalidated.online <= 0) {
                throw new SubscriptionChangeError(400, 'Online payment amount must be greater than zero.');
            }

            paymentValidation.wallet = revalidated.wallet;
            paymentValidation.cash = revalidated.cash;
            paymentValidation.online = revalidated.online;
            paymentValidation.payment_method = revalidated.payment_method;

            let walletLedgerDebitId = null;

            if (paymentValidation.wallet > 0) {
                const debitLabel =
                    proration.change_type === 'downgrade' ? 'downgrade payment' : 'upgrade payment';
                const debitRow = await createWalletLedgerEntry(
                    {
                        partnerId: partner._id,
                        franchiseId: partner.franchise_id,
                        transactionType: 'debit',
                        amount: paymentValidation.wallet,
                        description: `Subscription ${debitLabel} (${currentPlan.plan_name} to ${newPlan.plan_name})`,
                        paymentMethod: 'wallet',
                        subscriptionChangeId: changeId,
                    },
                    session
                );
                walletLedgerDebitId = debitRow._id;
            }

            const [createdChange] = await PartnerSubscriptionChange.create(
                [
                    {
                        _id: changeId,
                        partner_id: partner._id,
                        from_plan_id: currentPlan._id,
                        to_plan_id: newPlan._id,
                        change_type: proration.change_type,
                        days_used: proration.days_used,
                        days_total: proration.days_total,
                        consumed_value: proration.consumed_value,
                        remaining_value: proration.remaining_value,
                        gross_new_plan_price: proration.gross_new_plan_price,
                        amount_to_pay: proration.amount_to_pay,
                        wallet_amount: paymentValidation.wallet,
                        cash_amount: 0,
                        wallet_credit: proration.wallet_credit,
                        payment_method: paymentValidation.payment_method,
                        payment_status: 'pending',
                        status: 'pending',
                        applied_at: null,
                        wallet_ledger_debit_id: walletLedgerDebitId,
                        wallet_ledger_credit_id: null,
                        razorpay_payment_link_id: paymentLink.payment_link_id,
                        transaction_reference: null,
                        created_at: now,
                        updated_at: now,
                    },
                ],
                { session }
            );

            pendingChange = createdChange.toObject();
        });
    } catch (err) {
        throw await mapExecutionError(err, partner._id, session);
    } finally {
        await endMongoSession(session);
    }

    if (!pendingChange) {
        throw new SubscriptionChangeError(500, 'Could not initiate online subscription payment.');
    }

    return {
        changeDoc: pendingChange,
        payment_url: paymentLink.payment_url,
        currentSubscription: subscription,
        currentPlan,
    };
};

const completeOnlineChangeFromWebhook = async (
    changeId,
    paymentLinkId,
    paidAmountPaise = null,
    gatewayMeta = {}
) => {
    const session = await mongoose.startSession();
    let result = null;

    try {
        await session.withTransaction(async () => {
            const change = await PartnerSubscriptionChange.findOne({
                _id: changeId,
                deleted_at: null,
            }).session(session);

            if (!change) {
                throw new SubscriptionChangeError(404, 'Subscription change not found.');
            }

            if (
                change.razorpay_payment_link_id &&
                change.razorpay_payment_link_id !== paymentLinkId
            ) {
                throw new SubscriptionChangeError(404, 'Subscription change payment link mismatch.');
            }

            if (!change.razorpay_payment_link_id) {
                change.razorpay_payment_link_id = paymentLinkId;
            }

            if (change.status === 'completed') {
                result = { ok: true, already_completed: true, change_id: change._id };
                return;
            }

            if (change.status !== 'pending') {
                throw new SubscriptionChangeError(
                    409,
                    `Subscription change is ${change.status} and cannot be completed.`
                );
            }

            const expectedOnlineRupees = roundAmount(
                Math.max(0, change.amount_to_pay - change.wallet_amount - change.cash_amount)
            );
            if (expectedOnlineRupees > PAYMENT_TOLERANCE) {
                if (paidAmountPaise == null || !Number.isFinite(Number(paidAmountPaise))) {
                    throw new SubscriptionChangeError(400, 'Paid amount missing from webhook payload.');
                }
                const expectedPaise = Math.round(expectedOnlineRupees * 100);
                if (Math.abs(Number(paidAmountPaise) - expectedPaise) > 1) {
                    throw new SubscriptionChangeError(
                        400,
                        `Paid amount mismatch: expected ${expectedPaise} paise, got ${paidAmountPaise}.`
                    );
                }
            }

            const subscription = await PartnerSubscription.findOne({
                partner_id: change.partner_id,
                status: 'active',
                deleted_at: null,
            })
                .session(session)
                .lean();

            if (!subscription) {
                throw new SubscriptionChangeError(404, 'Active subscription not found for partner.');
            }

            const currentPlan = await SubscriptionPlan.findById(change.from_plan_id)
                .session(session)
                .lean();
            const newPlan = await SubscriptionPlan.findById(change.to_plan_id).session(session).lean();

            if (!currentPlan || !newPlan) {
                throw new SubscriptionChangeError(404, 'Subscription plan not found.');
            }

            if (String(subscription.subscription_plan_id) !== String(currentPlan._id)) {
                throw new SubscriptionChangeError(
                    409,
                    'Subscription plan changed before payment could be applied.'
                );
            }

            const now = new Date();
            let walletLedgerCreditId = change.wallet_ledger_credit_id;

            if (
                change.change_type === 'downgrade' &&
                change.wallet_credit > 0 &&
                !walletLedgerCreditId
            ) {
                const partner = await User.findById(change.partner_id)
                    .select('_id franchise_id')
                    .session(session)
                    .lean();
                const creditRow = await createWalletLedgerEntry(
                    {
                        partnerId: change.partner_id,
                        franchiseId: partner?.franchise_id,
                        transactionType: 'credit',
                        amount: change.wallet_credit,
                        description: `Subscription downgrade credit (${currentPlan.plan_name} to ${newPlan.plan_name})`,
                        paymentMethod: 'subscription_downgrade',
                        subscriptionChangeId: change._id,
                    },
                    session
                );
                walletLedgerCreditId = creditRow._id;
            }

            const { updated, plan: updatedPlan } = await applySubscriptionUpdate(
                subscription._id,
                newPlan._id,
                currentPlan._id,
                now,
                session
            );

            change.status = 'completed';
            change.payment_status = 'completed';
            change.applied_at = now;
            change.transaction_reference =
                gatewayMeta.gateway_payment_id || paymentLinkId;
            change.wallet_ledger_credit_id = walletLedgerCreditId;
            change.updated_at = now;
            await change.save({ session });

            const onlineAmount = roundAmount(
                Math.max(0, change.amount_to_pay - change.wallet_amount - change.cash_amount)
            );
            if (onlineAmount > PAYMENT_TOLERANCE) {
                await recordGatewayPayment(
                    {
                        purpose: PAYMENT_PURPOSES.SUBSCRIPTION_CHANGE,
                        referenceId: change._id,
                        payerType: 'partner',
                        payerId: change.partner_id,
                        amount: onlineAmount,
                        gatewayPaymentLinkId: paymentLinkId,
                        gatewayPaymentId: gatewayMeta.gateway_payment_id || null,
                        instrumentType: gatewayMeta.instrument_type || null,
                        paidAt: gatewayMeta.paid_at || now,
                        notes: 'Subscription change — Razorpay online payment',
                    },
                    session
                );
            }

            result = {
                ok: true,
                change_id: change._id,
                updatedSubscription: updated,
                updatedPlan,
            };
        });
    } catch (err) {
        if (err instanceof SubscriptionChangeError) {
            return { ok: false, message: err.message, status: err.status };
        }
        console.error('completeOnlineChangeFromWebhook', err.message, err.stack || '');
        return { ok: false, message: 'Failed to complete subscription change.' };
    } finally {
        await endMongoSession(session);
    }

    if (
        result?.ok &&
        !result?.already_completed &&
        result.updatedSubscription &&
        result.updatedPlan
    ) {
        void safeNotifySubscriptionPlanChanged({
            subscription: result.updatedSubscription,
            planName: result.updatedPlan.plan_name,
            paymentCompleted: true,
            actorUserId: result.updatedSubscription.partner_id,
        });
    }

    return result || { ok: false, message: 'Failed to complete subscription change.' };
};

/**
 * When webhook delivery fails (common on Lambda), poll Razorpay and complete pending changes.
 */
const syncPendingOnlineChangePayment = async (changeId, partnerId) => {
    const change = await PartnerSubscriptionChange.findOne({
        _id: changeId,
        partner_id: partnerId,
        deleted_at: null,
    }).lean();

    if (!change) {
        return { synced: false, reason: 'not_found' };
    }

    if (change.status === 'completed') {
        return { synced: false, reason: 'already_completed' };
    }

    if (change.status !== 'pending' || !change.razorpay_payment_link_id) {
        return { synced: false, reason: 'not_pending_online' };
    }

    let link;
    try {
        link = await fetchPaymentLink(change.razorpay_payment_link_id);
    } catch (err) {
        console.error('syncPendingOnlineChangePayment fetchPaymentLink', err?.response?.data || err.message);
        return { synced: false, reason: 'razorpay_fetch_failed' };
    }

    if (link.status !== 'paid') {
        return { synced: false, reason: 'not_paid', razorpay_status: link.status };
    }

    const paidAmountPaise =
        link.amount_paid != null ? Number(link.amount_paid) : Number(link.amount);

    const completion = await completeOnlineChangeFromWebhook(
        change._id,
        change.razorpay_payment_link_id,
        paidAmountPaise,
        {
            gateway_payment_id: extractPaymentIdFromLink(link),
            instrument_type: link.payments?.[0]?.method || null,
            paid_at: link.updated_at ? new Date(link.updated_at * 1000) : new Date(),
        }
    );

    if (!completion?.ok) {
        return {
            synced: false,
            reason: 'completion_failed',
            message: completion?.message || 'Failed to complete subscription change.',
        };
    }

    return { synced: true, change_id: change._id, already_completed: !!completion.already_completed };
};

const getChangePaymentStatus = async (partnerId, changeId) => {
    try {
        const pPartner = parseObjectId(partnerId, 'partner_id');
        if (!pPartner.ok) return fail(400, pPartner.message);

        const pChange = parseObjectId(changeId, 'change_id');
        if (!pChange.ok) return fail(400, pChange.message);

        const partner = await loadPartnerUser(pPartner.oid);
        const accountError = assertPartnerAccount(partner);
        if (accountError) return accountError;

        const change = await PartnerSubscriptionChange.findOne({
            _id: pChange.oid,
            partner_id: pPartner.oid,
            deleted_at: null,
        })
            .populate('to_plan_id', 'plan_name price duration duration_type priority')
            .lean();

        if (!change) {
            return fail(404, 'Subscription change not found.');
        }

        let syncResult = null;
        if (change.status === 'pending' && change.razorpay_payment_link_id) {
            syncResult = await syncPendingOnlineChangePayment(change._id, pPartner.oid);
        }

        let latestChange = change;
        if (syncResult?.synced) {
            latestChange = await PartnerSubscriptionChange.findOne({
                _id: pChange.oid,
                partner_id: pPartner.oid,
                deleted_at: null,
            })
                .populate('to_plan_id', 'plan_name price duration duration_type priority')
                .lean();
        }

        const walletBalance = await getWalletBalance(pPartner.oid);

        let gatewayPayment = null;
        let paymentUrl = null;
        if (latestChange.status === 'pending' && latestChange.razorpay_payment_link_id) {
            try {
                const link = await fetchPaymentLink(latestChange.razorpay_payment_link_id);
                if (RAZORPAY_LINK_RESUMABLE.has(link.status) && link.short_url) {
                    paymentUrl = link.short_url;
                }
            } catch (err) {
                console.error('getChangePaymentStatus fetchPaymentLink', err?.response?.data || err.message);
            }
        }
        if (latestChange.status === 'completed' && latestChange.razorpay_payment_link_id) {
            const GatewayPayment = require('../../../models/gateway_payment');
            gatewayPayment = await GatewayPayment.findOne({
                purpose: PAYMENT_PURPOSES.SUBSCRIPTION_CHANGE,
                reference_id: latestChange._id,
                deleted_at: null,
            })
                .select(
                    'amount currency status payment_method gateway_payment_link_id gateway_payment_id instrument_type paid_at created_at'
                )
                .lean();
        }

        return ok(200, {
            message: syncResult?.synced
                ? 'Payment verified with Razorpay and subscription change applied.'
                : 'Subscription change payment status fetched successfully.',
            data: {
                change_id: latestChange._id,
                status: latestChange.status,
                payment_status: latestChange.payment_status,
                payment_method: latestChange.payment_method,
                amount_to_pay: latestChange.amount_to_pay,
                wallet_amount: latestChange.wallet_amount,
                online_amount: roundAmount(
                    Math.max(
                        0,
                        latestChange.amount_to_pay -
                            latestChange.wallet_amount -
                            latestChange.cash_amount
                    )
                ),
                razorpay_payment_link_id: latestChange.razorpay_payment_link_id,
                payment_url: paymentUrl,
                applied_at: latestChange.applied_at,
                target_plan: formatPlanSummary(latestChange.to_plan_id),
                wallet_balance: walletBalance,
                gateway_payment: gatewayPayment,
                ...(syncResult
                    ? {
                          sync: {
                              attempted: change.status === 'pending',
                              synced: syncResult.synced,
                              reason: syncResult.reason || null,
                              razorpay_status: syncResult.razorpay_status || null,
                          },
                      }
                    : {}),
            },
        });
    } catch (err) {
        console.error('getChangePaymentStatus', err.message);
        return fail(500, 'Internal server error.');
    }
};

const applyChange = async (partnerId, body) => {
    try {
        const { target_plan_id, wallet_amount = 0, cash_amount = 0, online_amount = 0 } = body;

        const ctx = await buildChangeContext(partnerId, target_plan_id);
        if (!ctx.ok) return ctx;

        const { partner, subscription, currentPlan, newPlan, proration } = ctx.data;

        await releaseStalePendingChanges(partner._id);

        let paymentValidation = { wallet: 0, cash: 0, online: 0, payment_method: 'not_required' };

        if (proration.amount_to_pay > 0) {
            const walletBalance = await getWalletBalance(partner._id);
            paymentValidation = validateUpgradePaymentSplit({
                amountToPay: proration.amount_to_pay,
                walletAmount: wallet_amount,
                cashAmount: cash_amount,
                onlineAmount: online_amount,
                walletBalance,
            });
            if (!paymentValidation.ok) {
                return fail(400, paymentValidation.message);
            }
        }

        const requiresOnlineGateway = (paymentValidation.online ?? 0) > 0;

        if (requiresOnlineGateway) {
            if (!partner.email && !partner.phone_number) {
                return fail(
                    400,
                    'Email or phone number is required on your profile to pay online.'
                );
            }

            const resumeOutcome = await tryResumeOrClearPendingOnlineChange({
                partner,
                subscription,
                currentPlan,
                newPlan,
                proration,
                paymentValidation,
            });

            if (resumeOutcome.action === 'resume' || resumeOutcome.action === 'completed') {
                const newWalletBalance = await getWalletBalance(partner._id);
                return buildApplySuccessResponse(
                    proration,
                    paymentValidation,
                    resumeOutcome.txResult,
                    newWalletBalance
                );
            }

            if (resumeOutcome.action === 'blocked') {
                return fail(409, resumeOutcome.message, {
                    details: resumeOutcome.details || {},
                });
            }

            let txResult = null;
            let lastInProgressError = null;

            for (let attempt = 1; attempt <= APPLY_CHANGE_MAX_ATTEMPTS; attempt++) {
                try {
                    await releaseStalePendingChanges(partner._id);
                    txResult = await initiateOnlineChangeInTransaction({
                        partner,
                        subscription,
                        currentPlan,
                        newPlan,
                        proration,
                        paymentValidation,
                    });
                    lastInProgressError = null;
                    break;
                } catch (err) {
                    if (!(err instanceof SubscriptionChangeError) || err.status !== 409) {
                        throw err;
                    }
                    if (isRetryableInProgressError(err) && attempt < APPLY_CHANGE_MAX_ATTEMPTS) {
                        lastInProgressError = err;
                        await sleep(100 * attempt);
                        continue;
                    }
                    throw err;
                }
            }

            if (!txResult) {
                throw (
                    lastInProgressError ||
                    new SubscriptionChangeError(500, 'Subscription change could not be initiated.')
                );
            }

            const newWalletBalance = await getWalletBalance(partner._id);
            return buildApplySuccessResponse(
                proration,
                paymentValidation,
                txResult,
                newWalletBalance
            );
        }

        let txResult = null;
        let lastInProgressError = null;

        for (let attempt = 1; attempt <= APPLY_CHANGE_MAX_ATTEMPTS; attempt++) {
            try {
                await releaseStalePendingChanges(partner._id);
                txResult = await executeChangeInTransaction({
                    partner,
                    subscription,
                    currentPlan,
                    newPlan,
                    proration,
                    paymentValidation,
                });
                lastInProgressError = null;
                break;
            } catch (err) {
                if (!(err instanceof SubscriptionChangeError) || err.status !== 409) {
                    throw err;
                }

                const idempotent = await resolveIdempotentApply(partner._id, newPlan, proration);
                if (idempotent) {
                    return buildApplySuccessResponse(
                        proration,
                        paymentValidation,
                        null,
                        idempotent.walletBalance,
                        {
                            subscription: idempotent.subscription,
                            plan: idempotent.plan,
                            _id: idempotent.recentChange?._id,
                        }
                    );
                }

                if (isRetryableInProgressError(err) && attempt < APPLY_CHANGE_MAX_ATTEMPTS) {
                    lastInProgressError = err;
                    await sleep(100 * attempt);
                    continue;
                }

                throw err;
            }
        }

        if (!txResult) {
            throw (
                lastInProgressError ||
                new SubscriptionChangeError(500, 'Subscription change could not be completed.')
            );
        }

        const newWalletBalance = await getWalletBalance(partner._id);
        return buildApplySuccessResponse(
            proration,
            paymentValidation,
            txResult,
            newWalletBalance
        );
    } catch (err) {
        if (err instanceof SubscriptionChangeError) {
            return fail(
                err.status,
                err.message,
                err.details ? { details: err.details } : {}
            );
        }
        console.error('applyChange', err.message, err.stack || '');
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    getSubscriptionSummary,
    previewChange,
    applyChange,
    listChangeHistory,
    getChangePaymentStatus,
    completeOnlineChangeFromWebhook,
};
