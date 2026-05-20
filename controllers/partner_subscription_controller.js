const partnerSubscriptionService = require('../services/partner_subscription_service');
const subscriptionPlanService = require('../services/subscription_plan_service');

const sendServiceResult = (res, result) => {
    if (!result.ok) {
        return res.status(result.status).json({
            success: false,
            status: result.status,
            message: result.message,
            ...(result.error !== undefined && { error: result.error }),
        });
    }
    return res.status(result.status).json({
        success: true,
        status: result.status,
        ...result.data,
    });
};

const getAll = async (req, res) => {
    const result = await partnerSubscriptionService.listPartnerSubscriptions(req.query, req);
    return sendServiceResult(res, result);
};

const create = async (req, res) => {
    const result = await partnerSubscriptionService.createPartnerSubscription(req.body, req.user.id);
    return sendServiceResult(res, result);
};

const update = async (req, res) => {
    const result = await partnerSubscriptionService.updatePartnerSubscription(req.params.id, req.body);
    return sendServiceResult(res, result);
};

const getById = async (req, res) => {
    const result = await partnerSubscriptionService.getPartnerSubscriptionById(req.params.id);
    return sendServiceResult(res, result);
};

const deletePartnerSubscription = async (req, res) => {
    const result = await partnerSubscriptionService.softDeletePartnerSubscription(req.params.id);
    return sendServiceResult(res, result);
};

const importRecords = async (req, res) => {
    const result = await partnerSubscriptionService.importPartnerSubscriptions(req.body.records, req.user.id);
    return sendServiceResult(res, result);
};

const getMine = async (req, res) => {
    const result = await partnerSubscriptionService.getMySubscription(req.user.id);
    return sendServiceResult(res, result);
};

const getSubscriptionPlans = async (req, res) => {
    const result = await subscriptionPlanService.listAllSubscriptionPlans();
    return sendServiceResult(res, result);
};

module.exports = {
    getAll,
    create,
    update,
    getById,
    deletePartnerSubscription,
    importRecords,
    getMine,
    getSubscriptionPlans,
};
