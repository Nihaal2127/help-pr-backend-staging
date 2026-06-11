const mongoose = require('mongoose');
const PartnerSubscription = require('../../../models/partner_subscription');
const SubscriptionPlan = require('../../../models/subscription_plan');
const PartnerSubscriptionChange = require('../../../models/partner_subscription_change');
const PartnerWalletLedger = require('../../../models/partner_wallet_ledger');
const User = require('../../../models/user');
const { getWalletAggregatesForPartners } = require('../../partner_payout_service');
const {
    roundAmount,
    computeExpiresAt,
    computeProration,
    validateUpgradePaymentSplit,
} = require('../../../utils/subscription_proration');

const USER_TYPE_PARTNER = 2;
/** Pending rows older than this are treated as orphaned (failed/crashed apply). */
const PENDING_CHANGE_STALE_MS = 60 * 1000;
const APPLY_CHANGE_MAX_ATTEMPTS = 3;
const DUPLICATE_KEY_LOOKUP_ATTEMPTS = 4;
const DUPLICATE_KEY_LOOKUP_DELAY_MS = 75;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        payment_method: paymentValidation.payment_method,
    };
    if (proration.change_type === 'downgrade') {
        changePayload.wallet_credit = proration.wallet_credit;
    }

    return ok(200, {
        message:
            proration.change_type === 'downgrade'
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
    const cutoff = new Date(Date.now() - PENDING_CHANGE_STALE_MS);
    const query = PartnerSubscriptionChange.updateMany(
        {
            partner_id: partnerId,
            status: 'pending',
            deleted_at: null,
            applied_at: null,
            created_at: { $lt: cutoff },
        },
        {
            $set: {
                status: 'expired',
                updated_at: new Date(),
            },
        }
    );
    if (session) {
        query.session(session);
    }
    const result = await query;
    return result.modifiedCount || 0;
};

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

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
        .select('_id name email franchise_id verification_status is_blocked')
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
    return row;
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
                    walletBalance: freshBalance,
                });
                if (!revalidated.ok) {
                    throw new SubscriptionChangeError(400, revalidated.message);
                }
                paymentValidation.wallet = revalidated.wallet;
                paymentValidation.cash = revalidated.cash;
                paymentValidation.payment_method = revalidated.payment_method;
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

    return result;
};

const applyChange = async (partnerId, body) => {
    try {
        const { target_plan_id, wallet_amount = 0, cash_amount = 0 } = body;

        const ctx = await buildChangeContext(partnerId, target_plan_id);
        if (!ctx.ok) return ctx;

        const { partner, subscription, currentPlan, newPlan, proration } = ctx.data;

        await releaseStalePendingChanges(partner._id);

        let paymentValidation = { wallet: 0, cash: 0, payment_method: 'not_required' };

        if (proration.amount_to_pay > 0) {
            const walletBalance = await getWalletBalance(partner._id);
            paymentValidation = validateUpgradePaymentSplit({
                amountToPay: proration.amount_to_pay,
                walletAmount: wallet_amount,
                cashAmount: cash_amount,
                walletBalance,
            });
            if (!paymentValidation.ok) {
                return fail(400, paymentValidation.message);
            }
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
};
