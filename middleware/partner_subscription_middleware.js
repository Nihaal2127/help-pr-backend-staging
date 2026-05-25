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
    const { partner_id, subscription_plan_id, status } = req.body;

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
    next();
};

module.exports = {
    createPartnerSubscriptionMiddleware,
    updatePartnerSubscriptionMiddleware,
};
