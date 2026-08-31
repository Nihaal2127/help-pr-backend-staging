const mongoose = require('mongoose');
const PartnerSubscription = require('../../../models/partner_subscription');
const PartnerSubscriptionChange = require('../../../models/partner_subscription_change');
const SubscriptionPlan = require('../../../models/subscription_plan');
const AppleIapTransaction = require('../../../models/apple_iap_transaction');
const User = require('../../../models/user');
const { fieldLabel } = require('../../../utils/field_labels');
const { fail, ok } = require('../../../utils/mobile_service_result');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');
const { DEFAULT_PARTNER_PLAN_NAME } = require('../../../constants/partner_subscription');
const {
    appleProductIdForPlanName,
    planNameForAppleProductId,
    BILLING_SOURCE_APPLE_IAP,
    APPLE_PAYMENT_METHOD,
    APPLE_NOTIFICATION_REVOKE,
    APPLE_PENDING_EXPIRY_MS,
} = require('../../../constants/apple_iap');
const {
    getBundleId,
    verifyAndDecodeTransaction,
    verifyAndDecodeRenewalInfo,
    verifyAndDecodeNotification,
    fetchTransactionFromApple,
} = require('../../../src/modules/apple_iap');
const { getWalletAggregatesForPartners } = require('../../partner_payout_service');
const { roundAmount } = require('../../../utils/subscription_proration');
const {
    safeNotifySubscriptionPlanChanged,
} = require('../../../src/modules/notifications/services/domainHooks');

const OBJECT_ID_HEX_24 = /^[a-fA-F0-9]{24}$/;

class AppleIapError extends Error {
    constructor(status, message, details = null) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

const parseObjectId = (raw, fieldName = 'id') => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!s || !OBJECT_ID_HEX_24.test(s)) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be a valid ObjectId.` };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const msToDate = (ms) => {
    if (ms === undefined || ms === null || ms === '') {
        return null;
    }
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) {
        return null;
    }
    return new Date(n);
};

const getWalletBalance = async (partnerOid) => {
    const map = await getWalletAggregatesForPartners([partnerOid]);
    const row = map.get(String(partnerOid));
    return row ? roundAmount(row.total_wallet_amount) : 0;
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
        apple_product_id: appleProductIdForPlanName(plan.plan_name),
    };
};

const formatSubscriptionPayload = (subscription, plan) => {
    if (!subscription) {
        return null;
    }
    return {
        _id: subscription._id,
        started_at: subscription.started_at,
        expires_at: subscription.expires_at,
        status: subscription.status,
        billing_source: subscription.billing_source || null,
        apple_product_id: subscription.apple_product_id || null,
        apple_original_transaction_id: subscription.apple_original_transaction_id || null,
        apple_auto_renew_status: subscription.apple_auto_renew_status,
        plan: formatPlanSummary(plan),
    };
};

const formatChangePayload = (change, extras = {}) => ({
    _id: change?._id || null,
    change_type: change?.change_type || null,
    amount_to_pay: change?.amount_to_pay ?? 0,
    wallet_amount: change?.wallet_amount ?? 0,
    cash_amount: 0,
    online_amount: 0,
    payment_method: change?.payment_method || APPLE_PAYMENT_METHOD,
    payment_status: change?.payment_status || 'pending',
    status: change?.status || 'pending',
    payment_url: null,
    apple_product_id: change?.apple_product_id || extras.apple_product_id || null,
    apple_transaction_id: change?.apple_transaction_id || null,
    apple_original_transaction_id: change?.apple_original_transaction_id || null,
    applied_at: change?.applied_at || null,
    ...extras,
});

const loadPartnerUser = async (partnerOid) =>
    User.findOne({
        _id: partnerOid,
        type: USER_TYPE_PARTNER,
        deleted_at: null,
    })
        .select('_id name email phone_number franchise_id verification_status is_blocked')
        .lean();

const assertEligibleForChange = (partner) => {
    if (!partner) {
        return fail(403, 'Only partner accounts can access this resource.');
    }
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

const loadPartnerSubscription = async (partnerOid) =>
    PartnerSubscription.findOne({
        partner_id: partnerOid,
        status: 'active',
        deleted_at: null,
    })
        .sort({ updated_at: -1, created_at: -1 })
        .populate('subscription_plan_id')
        .lean();

const loadActivePlanByName = async (planName) =>
    SubscriptionPlan.findOne({
        plan_name: planName,
        is_active: true,
        deleted_at: null,
    }).lean();

const resolvePlanFromDoc = (subscription) => {
    const ref = subscription?.subscription_plan_id;
    if (ref && typeof ref === 'object' && ref.plan_name) {
        return ref;
    }
    return null;
};

const expireApplePendingRow = async (row) => {
    const now = new Date();
    await PartnerSubscriptionChange.findOneAndUpdate(
        { _id: row._id, status: 'pending', deleted_at: null },
        {
            $set: {
                status: 'expired',
                payment_status: 'failed',
                updated_at: now,
            },
        }
    );
};

const releaseStaleApplePendingChanges = async (partnerId) => {
    const cutoff = new Date(Date.now() - APPLE_PENDING_EXPIRY_MS);
    const stale = await PartnerSubscriptionChange.find({
        partner_id: partnerId,
        status: 'pending',
        payment_method: APPLE_PAYMENT_METHOD,
        deleted_at: null,
        created_at: { $lt: cutoff },
    })
        .select('_id')
        .lean();
    for (const row of stale) {
        await expireApplePendingRow(row);
    }
};

const isEntitlementActive = (decoded) => {
    if (decoded?.revocationDate) {
        return false;
    }
    const expiresAt = msToDate(decoded?.expiresDate);
    if (!expiresAt) {
        return false;
    }
    return expiresAt.getTime() > Date.now();
};

const recordAppleTransaction = async ({
    partnerId,
    changeId,
    decoded,
    source,
    notificationType,
    notificationSubtype,
    notificationUuid,
}) => {
    const now = new Date();
    const doc = {
        partner_id: partnerId,
        change_id: changeId || null,
        transaction_id: String(decoded.transactionId),
        original_transaction_id: String(decoded.originalTransactionId),
        product_id: decoded.productId,
        bundle_id: decoded.bundleId,
        environment: decoded.environment || null,
        expires_at: msToDate(decoded.expiresDate),
        purchase_date: msToDate(decoded.purchaseDate),
        notification_uuid: notificationUuid || null,
        notification_type: notificationType || null,
        notification_subtype: notificationSubtype || null,
        source,
        updated_at: now,
    };

    try {
        await AppleIapTransaction.updateOne(
            { transaction_id: doc.transaction_id, deleted_at: null },
            {
                $set: doc,
                $setOnInsert: { created_at: now },
            },
            { upsert: true }
        );
    } catch (err) {
        if (err?.code !== 11000) {
            throw err;
        }
    }
};

const assertTransactionOwnership = async (partnerId, originalTransactionId) => {
    const existing = await PartnerSubscription.findOne({
        apple_original_transaction_id: originalTransactionId,
        deleted_at: null,
    })
        .select('_id partner_id')
        .lean();

    if (existing && String(existing.partner_id) !== String(partnerId)) {
        throw new AppleIapError(
            409,
            'This App Store subscription is already linked to another partner account.',
            { reason: 'apple_original_transaction_owned' }
        );
    }
};

const applyAppleEntitlement = async ({
    partnerId,
    decoded,
    renewalInfo = null,
    change = null,
    source,
    notificationType = null,
    notificationSubtype = null,
    notificationUuid = null,
}) => {
    const originalTransactionId = String(decoded.originalTransactionId || '').trim();
    const productId = String(decoded.productId || '').trim();
    if (!originalTransactionId || !productId) {
        throw new AppleIapError(400, 'Apple transaction is missing identifiers.');
    }

    await assertTransactionOwnership(partnerId, originalTransactionId);

    const bundleId = getBundleId();
    if (decoded.bundleId && decoded.bundleId !== bundleId) {
        throw new AppleIapError(400, 'Apple transaction bundle does not match this app.');
    }

    await recordAppleTransaction({
        partnerId,
        changeId: change?._id || null,
        decoded,
        source,
        notificationType,
        notificationSubtype,
        notificationUuid,
    });

    const subscription = await PartnerSubscription.findOne({
        partner_id: partnerId,
        status: 'active',
        deleted_at: null,
    }).sort({ updated_at: -1, created_at: -1 });

    if (!subscription) {
        throw new AppleIapError(404, 'Active subscription not found for partner.');
    }

    const now = new Date();
    const autoRenewStatus =
        renewalInfo?.autoRenewStatus === undefined || renewalInfo?.autoRenewStatus === null
            ? subscription.apple_auto_renew_status
            : Number(renewalInfo.autoRenewStatus);

    const shouldRevoke =
        Boolean(decoded.revocationDate) ||
        APPLE_NOTIFICATION_REVOKE.has(String(notificationType || '')) ||
        !isEntitlementActive(decoded);

    let targetPlan = null;
    if (shouldRevoke) {
        targetPlan = await loadActivePlanByName(DEFAULT_PARTNER_PLAN_NAME);
        if (!targetPlan) {
            throw new AppleIapError(500, 'Default subscription plan "basic" is not configured.');
        }
    } else {
        const planName = planNameForAppleProductId(productId);
        if (!planName) {
            throw new AppleIapError(400, 'Apple product is not mapped to a subscription plan.');
        }
        targetPlan = await loadActivePlanByName(planName);
        if (!targetPlan) {
            throw new AppleIapError(404, 'Target subscription plan not found, inactive, or deleted.');
        }
    }

    const previousPlanId = subscription.subscription_plan_id;
    const planChanged = String(previousPlanId) !== String(targetPlan._id);
    const purchaseDate = msToDate(decoded.purchaseDate) || now;

    subscription.subscription_plan_id = targetPlan._id;
    if (planChanged) {
        subscription.started_at = shouldRevoke ? now : purchaseDate;
    }
    subscription.expires_at = shouldRevoke ? null : msToDate(decoded.expiresDate);
    subscription.status = 'active';
    subscription.billing_source = BILLING_SOURCE_APPLE_IAP;
    subscription.apple_original_transaction_id = originalTransactionId;
    subscription.apple_product_id = shouldRevoke ? null : productId;
    subscription.apple_environment = decoded.environment || null;
    subscription.apple_auto_renew_status = Number.isFinite(autoRenewStatus) ? autoRenewStatus : null;
    subscription.updated_at = now;
    await subscription.save();

    let updatedChange = change;
    if (change && change.status === 'pending') {
        const changeProduct = String(change.apple_product_id || '').trim();
        const shouldCompleteChange =
            shouldRevoke || !changeProduct || changeProduct === productId;
        if (shouldCompleteChange) {
            change.status = 'completed';
            change.payment_status = 'completed';
            change.applied_at = now;
            change.apple_transaction_id = String(decoded.transactionId);
            change.apple_original_transaction_id = originalTransactionId;
            change.apple_environment = decoded.environment || null;
            change.transaction_reference = String(decoded.transactionId);
            change.updated_at = now;
            await change.save();
            updatedChange = change;
        }
    }

    const updated = subscription.toObject();
    if (planChanged) {
        void safeNotifySubscriptionPlanChanged({
            subscription: updated,
            planName: targetPlan.plan_name,
            paymentCompleted: !shouldRevoke,
            actorUserId: partnerId,
        });
    }

    return {
        subscription: updated,
        plan: targetPlan,
        change: updatedChange,
        revoked: shouldRevoke,
        already_entitled: !planChanged,
    };
};

const decodeOrFetchTransaction = async (body) => {
    const signed = body?.signed_transaction_info || body?.signedTransactionInfo;
    if (signed) {
        return verifyAndDecodeTransaction(signed);
    }
    const transactionId = body?.transaction_id || body?.transactionId;
    const fetched = await fetchTransactionFromApple(transactionId);
    if (!fetched) {
        throw new AppleIapError(400, `${fieldLabel('signed_transaction_info')} is required.`);
    }
    return fetched;
};

const initiateAppleChange = async (partnerId, body = {}) => {
    try {
        const walletAmount = Number(body.wallet_amount || 0);
        const cashAmount = Number(body.cash_amount || 0);
        const onlineAmount = Number(body.online_amount || 0);
        if (walletAmount > 0 || cashAmount > 0 || onlineAmount > 0) {
            return fail(400, 'Do not mix wallet, cash, or online amounts with App Store payment.');
        }

        const pPartner = parseObjectId(partnerId, 'partner_id');
        if (!pPartner.ok) return fail(400, pPartner.message);

        const pTarget = parseObjectId(body.target_plan_id, 'target_plan_id');
        if (!pTarget.ok) return fail(400, pTarget.message);

        const partner = await loadPartnerUser(pPartner.oid);
        const eligibilityError = assertEligibleForChange(partner);
        if (eligibilityError) return eligibilityError;

        const subscription = await loadPartnerSubscription(pPartner.oid);
        if (!subscription) {
            return fail(404, 'No active subscription found.');
        }

        const currentPlan = resolvePlanFromDoc(subscription) || (await SubscriptionPlan.findById(subscription.subscription_plan_id).lean());
        if (!currentPlan) {
            return fail(404, 'Current subscription plan is not available.');
        }

        const newPlan = await SubscriptionPlan.findOne({
            _id: pTarget.oid,
            deleted_at: null,
            is_active: true,
        }).lean();
        if (!newPlan) {
            return fail(404, 'Target subscription plan not found, inactive, or deleted.');
        }

        if (String(currentPlan._id) === String(newPlan._id)) {
            return fail(400, 'You are already on this subscription plan.');
        }

        const mappedProductId = appleProductIdForPlanName(newPlan.plan_name);
        if (!mappedProductId) {
            return fail(400, 'This plan cannot be purchased through the App Store.');
        }

        const requestedProductId = body.apple_product_id
            ? String(body.apple_product_id).trim()
            : mappedProductId;
        if (requestedProductId !== mappedProductId) {
            return fail(400, 'Apple product id does not match the selected plan.');
        }

        await releaseStaleApplePendingChanges(partner._id);

        const pending = await PartnerSubscriptionChange.findOne({
            partner_id: partner._id,
            status: 'pending',
            deleted_at: null,
        }).lean();

        if (pending) {
            if (pending.payment_method === APPLE_PAYMENT_METHOD) {
                if (
                    String(pending.to_plan_id) === String(newPlan._id) &&
                    String(pending.apple_product_id || '') === mappedProductId
                ) {
                    const walletBalance = await getWalletBalance(partner._id);
                    return ok(202, {
                        message: 'Continue your pending App Store purchase to complete the subscription change.',
                        data: {
                            subscription: formatSubscriptionPayload(subscription, currentPlan),
                            change: formatChangePayload(pending, { resumed: true }),
                            wallet_balance: walletBalance,
                        },
                    });
                }
                await expireApplePendingRow(pending);
            } else {
                return fail(
                    409,
                    'A subscription change is already in progress. Please try again shortly.',
                    { details: { change_id: pending._id, reason: 'active_pending' } }
                );
            }
        }

        const now = new Date();
        const currentPriority = Number(currentPlan.priority || 0);
        const newPriority = Number(newPlan.priority || 0);
        const changeType = newPriority >= currentPriority ? 'upgrade' : 'downgrade';

        const [created] = await PartnerSubscriptionChange.create([
            {
                partner_id: partner._id,
                from_plan_id: currentPlan._id,
                to_plan_id: newPlan._id,
                change_type: changeType,
                days_used: 0,
                days_total: 1,
                consumed_value: 0,
                remaining_value: 0,
                gross_new_plan_price: 0,
                amount_to_pay: 0,
                wallet_amount: 0,
                cash_amount: 0,
                wallet_credit: 0,
                payment_method: APPLE_PAYMENT_METHOD,
                payment_status: 'pending',
                status: 'pending',
                apple_product_id: mappedProductId,
                applied_at: null,
                created_at: now,
                updated_at: now,
            },
        ]);

        const walletBalance = await getWalletBalance(partner._id);
        return ok(202, {
            message: 'Complete the App Store purchase to apply your subscription change.',
            data: {
                subscription: formatSubscriptionPayload(subscription, currentPlan),
                change: formatChangePayload(created.toObject()),
                wallet_balance: walletBalance,
            },
        });
    } catch (err) {
        if (err instanceof AppleIapError) {
            return fail(err.status, err.message, err.details ? { details: err.details } : {});
        }
        console.error('initiateAppleChange', err.message, err.stack || '');
        return fail(500, 'Internal server error.');
    }
};

const buildVerifySuccess = async (partnerId, result, message) => {
    const walletBalance = await getWalletBalance(partnerId);
    return ok(200, {
        message,
        data: {
            subscription: formatSubscriptionPayload(result.subscription, result.plan),
            change: formatChangePayload(result.change),
            wallet_balance: walletBalance,
        },
    });
};

const verifyApplePurchase = async (partnerId, body = {}) => {
    try {
        const pPartner = parseObjectId(partnerId, 'partner_id');
        if (!pPartner.ok) return fail(400, pPartner.message);

        const partner = await loadPartnerUser(pPartner.oid);
        const eligibilityError = assertEligibleForChange(partner);
        if (eligibilityError) return eligibilityError;

        const { decoded } = await decodeOrFetchTransaction(body);
        const renewalInfo = body.signed_renewal_info
            ? await verifyAndDecodeRenewalInfo(body.signed_renewal_info)
            : null;

        let change = null;
        if (body.change_id) {
            const pChange = parseObjectId(body.change_id, 'change_id');
            if (!pChange.ok) return fail(400, pChange.message);

            change = await PartnerSubscriptionChange.findOne({
                _id: pChange.oid,
                partner_id: pPartner.oid,
                deleted_at: null,
            });
            if (!change) {
                return fail(404, 'Subscription change not found.');
            }
            if (change.payment_method !== APPLE_PAYMENT_METHOD) {
                return fail(400, 'This subscription change is not an App Store payment.');
            }

            if (change.status === 'completed') {
                const subscription = await loadPartnerSubscription(pPartner.oid);
                const plan = resolvePlanFromDoc(subscription);
                const walletBalance = await getWalletBalance(pPartner.oid);
                return ok(200, {
                    message: 'Subscription change already completed.',
                    data: {
                        subscription: formatSubscriptionPayload(subscription, plan),
                        change: formatChangePayload(change.toObject()),
                        wallet_balance: walletBalance,
                    },
                });
            }

            if (change.status !== 'pending') {
                return fail(409, `Subscription change is ${change.status} and cannot be completed.`);
            }

            if (body.target_plan_id) {
                const pTarget = parseObjectId(body.target_plan_id, 'target_plan_id');
                if (!pTarget.ok) return fail(400, pTarget.message);
                if (String(change.to_plan_id) !== String(pTarget.oid)) {
                    return fail(400, 'Target plan does not match the pending App Store change.');
                }
            }

            const expectedProduct = String(change.apple_product_id || '').trim();
            const actualProduct = String(decoded.productId || '').trim();
            if (expectedProduct && actualProduct !== expectedProduct) {
                if (!isEntitlementActive(decoded) || decoded.revocationDate) {
                    const result = await applyAppleEntitlement({
                        partnerId: pPartner.oid,
                        decoded,
                        renewalInfo,
                        change,
                        source: 'verify',
                    });
                    return buildVerifySuccess(
                        pPartner.oid,
                        result,
                        'App Store subscription is no longer active. You have been moved to the Basic plan.'
                    );
                }

                await assertTransactionOwnership(pPartner.oid, String(decoded.originalTransactionId));
                change.apple_original_transaction_id = String(decoded.originalTransactionId);
                change.apple_transaction_id = String(decoded.transactionId);
                change.apple_environment = decoded.environment || null;
                change.updated_at = new Date();
                await change.save();

                const subscription = await loadPartnerSubscription(pPartner.oid);
                const plan = resolvePlanFromDoc(subscription);
                const walletBalance = await getWalletBalance(pPartner.oid);
                return ok(200, {
                    message:
                        'App Store purchase recorded. The new plan takes effect at the next renewal date.',
                    data: {
                        subscription: formatSubscriptionPayload(subscription, plan),
                        change: formatChangePayload(change.toObject(), {
                            payment_status: 'pending',
                            status: 'pending',
                        }),
                        wallet_balance: walletBalance,
                    },
                });
            }
        }

        const result = await applyAppleEntitlement({
            partnerId: pPartner.oid,
            decoded,
            renewalInfo,
            change,
            source: 'verify',
        });

        return buildVerifySuccess(
            pPartner.oid,
            result,
            result.revoked
                ? 'App Store subscription is no longer active. You have been moved to the Basic plan.'
                : 'Subscription upgraded successfully.'
        );
    } catch (err) {
        if (err instanceof AppleIapError) {
            return fail(err.status, err.message, err.details ? { details: err.details } : {});
        }
        if (err.status) {
            return fail(err.status, err.message, err.details ? { details: err.details } : {});
        }
        console.error('verifyApplePurchase', err.message, err.stack || '');
        return fail(500, 'Internal server error.');
    }
};

const restoreApplePurchase = async (partnerId, body = {}) => {
    try {
        const pPartner = parseObjectId(partnerId, 'partner_id');
        if (!pPartner.ok) return fail(400, pPartner.message);

        const partner = await loadPartnerUser(pPartner.oid);
        if (!partner) {
            return fail(403, 'Only partner accounts can access this resource.');
        }
        if (partner.is_blocked === true) {
            return fail(403, 'Your account is blocked. Please contact support.');
        }

        const { decoded } = await decodeOrFetchTransaction(body);
        const renewalInfo = body.signed_renewal_info
            ? await verifyAndDecodeRenewalInfo(body.signed_renewal_info)
            : null;

        const claimedOriginal = String(body.original_transaction_id || '').trim();
        if (claimedOriginal && claimedOriginal !== String(decoded.originalTransactionId)) {
            return fail(400, 'original_transaction_id does not match the signed Apple transaction.');
        }

        const pending = await PartnerSubscriptionChange.findOne({
            partner_id: pPartner.oid,
            status: 'pending',
            payment_method: APPLE_PAYMENT_METHOD,
            deleted_at: null,
            apple_product_id: decoded.productId,
        }).sort({ created_at: -1 });

        const result = await applyAppleEntitlement({
            partnerId: pPartner.oid,
            decoded,
            renewalInfo,
            change: pending,
            source: 'restore',
        });

        return buildVerifySuccess(
            pPartner.oid,
            result,
            result.revoked
                ? 'No active App Store subscription found. You have been moved to the Basic plan.'
                : 'App Store subscription restored successfully.'
        );
    } catch (err) {
        if (err instanceof AppleIapError) {
            return fail(err.status, err.message, err.details ? { details: err.details } : {});
        }
        if (err.status) {
            return fail(err.status, err.message, err.details ? { details: err.details } : {});
        }
        console.error('restoreApplePurchase', err.message, err.stack || '');
        return fail(500, 'Internal server error.');
    }
};

const handleAppleNotification = async (signedPayload) => {
    const { decoded: notification } = await verifyAndDecodeNotification(signedPayload);
    const notificationType = notification.notificationType || null;
    const notificationSubtype = notification.subtype || null;
    const notificationUuid = notification.notificationUUID || null;
    const signedTransactionInfo = notification.data?.signedTransactionInfo;
    const signedRenewalInfo = notification.data?.signedRenewalInfo;

    if (notificationUuid) {
        const already = await AppleIapTransaction.findOne({
            notification_uuid: notificationUuid,
            deleted_at: null,
        })
            .select('_id')
            .lean();
        if (already) {
            return { handled: true, duplicate: true, notification_uuid: notificationUuid };
        }
    }

    if (!signedTransactionInfo) {
        return { handled: true, ignored: true, reason: 'no_transaction', notificationType };
    }

    const { decoded } = await verifyAndDecodeTransaction(signedTransactionInfo);
    const renewalInfo = signedRenewalInfo
        ? await verifyAndDecodeRenewalInfo(signedRenewalInfo)
        : null;

    const originalTransactionId = String(decoded.originalTransactionId || '').trim();
    const subscription = await PartnerSubscription.findOne({
        apple_original_transaction_id: originalTransactionId,
        deleted_at: null,
    }).sort({ updated_at: -1, created_at: -1 });

    if (!subscription) {
        return {
            handled: true,
            ignored: true,
            reason: 'partner_not_linked',
            original_transaction_id: originalTransactionId,
            notificationType,
        };
    }

    const pending = await PartnerSubscriptionChange.findOne({
        partner_id: subscription.partner_id,
        status: 'pending',
        payment_method: APPLE_PAYMENT_METHOD,
        deleted_at: null,
    }).sort({ created_at: -1 });

    await applyAppleEntitlement({
        partnerId: subscription.partner_id,
        decoded,
        renewalInfo,
        change: pending,
        source: 'notification',
        notificationType,
        notificationSubtype,
        notificationUuid,
    });

    return {
        handled: true,
        notificationType,
        partner_id: subscription.partner_id,
        original_transaction_id: originalTransactionId,
    };
};

module.exports = {
    initiateAppleChange,
    verifyApplePurchase,
    restoreApplePurchase,
    handleAppleNotification,
    AppleIapError,
};
