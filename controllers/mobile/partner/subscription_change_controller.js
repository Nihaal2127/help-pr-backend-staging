const subscriptionChangeService = require('../../../services/mobile/partner/subscription_change_service');

const sendServiceResult = (res, result) => {
    if (!result.ok) {
        return res.status(result.status).json({
            success: false,
            status: result.status,
            message: result.message,
            ...(result.details ? { details: result.details } : {}),
        });
    }
    return res.status(result.status).json({
        success: true,
        status: result.status,
        message: result.data.message,
        data: result.data.data,
    });
};

const getSummary = async (req, res) => {
    try {
        const result = await subscriptionChangeService.getSubscriptionSummary(req.user.id);
        return sendServiceResult(res, result);
    } catch (err) {
        console.error('mobile partner subscription summary', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const previewChange = async (req, res) => {
    try {
        const result = await subscriptionChangeService.previewChange(
            req.user.id,
            req.body.target_plan_id
        );
        return sendServiceResult(res, result);
    } catch (err) {
        console.error('mobile partner subscription preview', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const applyChange = async (req, res) => {
    try {
        const result = await subscriptionChangeService.applyChange(req.user.id, req.body);
        return sendServiceResult(res, result);
    } catch (err) {
        console.error('mobile partner subscription change', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const listHistory = async (req, res) => {
    try {
        const result = await subscriptionChangeService.listChangeHistory(req.user.id, req.query);
        return sendServiceResult(res, result);
    } catch (err) {
        console.error('mobile partner subscription history', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

module.exports = {
    getSummary,
    previewChange,
    applyChange,
    listHistory,
};
