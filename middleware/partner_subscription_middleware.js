const User = require('../models/user');
const { canManagePartnerSubscriptions } = require('../utils/partner_subscription_access');

const createPartnerSubscriptionMiddleware = (req, res, next) => {
    const { partner_id, subscription_plan_id } = req.body;

    if (!partner_id || partner_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Partner is required.',
        });
    }
    if (!subscription_plan_id || subscription_plan_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Subscription plan is required.',
        });
    }
    next();
};

const updatePartnerSubscriptionMiddleware = (req, res, next) => {
    const { partner_id, subscription_plan_id, status, banner_image_url } = req.body;

    if (partner_id !== undefined && partner_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Partner cannot be empty.',
        });
    }
    if (subscription_plan_id !== undefined && subscription_plan_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Subscription plan cannot be empty.',
        });
    }
    if (status !== undefined && !['active', 'expired', 'cancelled'].includes(status)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'status must be active, expired, or cancelled.',
        });
    }
    if (
        banner_image_url !== undefined &&
        banner_image_url !== null &&
        banner_image_url !== '' &&
        typeof banner_image_url !== 'string'
    ) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'banner_image_url must be a string URL or null.',
        });
    }
    next();
};

const requirePartnerSubscriptionManagement = async (req, res, next) => {
    try {
        const caller = await User.findOne({ _id: req.user.id, deleted_at: null })
            .select('type franchise_id accessible_screens')
            .lean();
        if (!caller) {
            return res.status(401).json({
                success: false,
                status: 401,
                message: 'User not found.',
            });
        }

        const access = canManagePartnerSubscriptions(caller);
        if (!access.ok) {
            return res.status(access.status).json({
                success: false,
                status: access.status,
                message: access.message,
            });
        }

        next();
    } catch (err) {
        console.error('requirePartnerSubscriptionManagement', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

module.exports = {
    createPartnerSubscriptionMiddleware,
    updatePartnerSubscriptionMiddleware,
    requirePartnerSubscriptionManagement,
};
