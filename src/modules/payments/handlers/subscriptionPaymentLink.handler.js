const mongoose = require('mongoose');
const PartnerSubscriptionChange = require('../../../../models/partner_subscription_change');

const findPendingChangeForPaymentLink = async (paymentLinkId, paymentLinkEntity) => {
    const byLinkId = await PartnerSubscriptionChange.findOne({
        razorpay_payment_link_id: paymentLinkId,
        status: 'pending',
        deleted_at: null,
    }).lean();

    if (byLinkId) {
        return byLinkId;
    }

    const changeIdRaw = paymentLinkEntity?.notes?.change_id;
    if (!changeIdRaw || !mongoose.Types.ObjectId.isValid(String(changeIdRaw))) {
        return null;
    }

    return PartnerSubscriptionChange.findOne({
        _id: changeIdRaw,
        status: 'pending',
        deleted_at: null,
    }).lean();
};

/**
 * Handle payment_link.paid for a pending subscription change.
 * @param {string} paymentLinkId
 * @param {{ paymentLinkEntity?: object, paidAmountPaise?: number }} context
 */
const handleSubscriptionPaymentLinkPaid = async (paymentLinkId, context = {}) => {
    const { paymentLinkEntity, paidAmountPaise, paymentEntity } = context;

    const change = await findPendingChangeForPaymentLink(paymentLinkId, paymentLinkEntity);
    if (!change) {
        return { handled: false, reason: 'subscription_change_not_found' };
    }

    // Lazy require avoids circular dependency with subscription_change_service → payments module.
    const {
        completeOnlineChangeFromWebhook,
    } = require('../../../../services/mobile/partner/subscription_change_service');

    const result = await completeOnlineChangeFromWebhook(
        change._id,
        paymentLinkId,
        paidAmountPaise,
        {
            gateway_payment_id: context.paymentEntity?.id || null,
            instrument_type: context.paymentEntity?.method || null,
            paid_at: context.paymentEntity?.created_at
                ? new Date(Number(context.paymentEntity.created_at) * 1000)
                : new Date(),
        }
    );

    if (result.ok) {
        console.log(`Subscription change ${change._id} completed from Razorpay`);
        return { handled: true, change_id: change._id, already_completed: !!result.already_completed };
    }

    console.error('subscription payment webhook completion failed', result.message);

    if (result.status === 409 || result.status === 400) {
        return {
            handled: false,
            fatal: true,
            noRetry: true,
            reason: result.message,
            change_id: change._id,
        };
    }

    return {
        handled: false,
        fatal: true,
        reason: result.message,
        change_id: change._id,
    };
};

module.exports = {
    handleSubscriptionPaymentLinkPaid,
};
