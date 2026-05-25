const SubscriptionPlan = require('../models/subscription_plan');
const PLAN_NAMES = SubscriptionPlan.PLAN_NAMES;
const DURATION_TYPES = SubscriptionPlan.DURATION_TYPES;
const { fieldLabel } = require('../utils/field_labels');

const createSubscriptionPlanMiddleware = (req, res, next) => {
    const body = req.body;
    const {
        plan_name,
        plan_description,
        price,
        duration,
        duration_type,
        is_active,
    } = body;

    if (!plan_name || plan_name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Plan name (tier) is required.',
        });
    }
    if (!PLAN_NAMES.includes(String(plan_name).trim().toLowerCase())) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `${fieldLabel('plan_name')} must be one of: ${PLAN_NAMES.join(', ')}.`,
        });
    }
    if (plan_description === undefined || plan_description === null || String(plan_description).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Plan description is required.',
        });
    }
    if (price === undefined || price === null || String(price).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Price is required.',
        });
    }
    if (duration === undefined || duration === null || String(duration).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Duration is required.',
        });
    }
    if (!duration_type || duration_type === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Duration type is required.',
        });
    }
    if (!DURATION_TYPES.includes(String(duration_type).trim().toLowerCase())) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `${fieldLabel('duration_type')} must be one of: ${DURATION_TYPES.join(', ')}.`,
        });
    }
    if (is_active === undefined) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Status is required.',
        });
    }
    next();
};

const updateSubscriptionPlanMiddleware = (req, res, next) => {
    const body = req.body;
    const {
        plan_name,
        plan_description,
        price,
        duration,
        duration_type,
    } = body;

    if (plan_name !== undefined && plan_name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Plan name (tier) is required.',
        });
    }
    if (plan_name !== undefined && !PLAN_NAMES.includes(String(plan_name).trim().toLowerCase())) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `${fieldLabel('plan_name')} must be one of: ${PLAN_NAMES.join(', ')}.`,
        });
    }
    if (plan_description !== undefined && String(plan_description).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Plan description cannot be empty.',
        });
    }
    if (price !== undefined && String(price).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Price cannot be empty.',
        });
    }
    if (duration !== undefined && String(duration).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Duration cannot be empty.',
        });
    }
    if (duration_type !== undefined && duration_type !== '' && !DURATION_TYPES.includes(String(duration_type).trim().toLowerCase())) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `${fieldLabel('duration_type')} must be one of: ${DURATION_TYPES.join(', ')}.`,
        });
    }
    next();
};

module.exports = { createSubscriptionPlanMiddleware, updateSubscriptionPlanMiddleware };
