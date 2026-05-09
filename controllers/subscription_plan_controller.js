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
    const result = await subscriptionPlanService.listSubscriptionPlans(req.query);
    return sendServiceResult(res, result);
};

const create = async (req, res) => {
    const result = await subscriptionPlanService.createSubscriptionPlan(req.body);
    return sendServiceResult(res, result);
};

const update = async (req, res) => {
    const result = await subscriptionPlanService.updateSubscriptionPlan(req.params.id, req.body);
    return sendServiceResult(res, result);
};

const getById = async (req, res) => {
    const result = await subscriptionPlanService.getSubscriptionPlanById(req.params.id);
    return sendServiceResult(res, result);
};

const deleteSubscriptionPlan = async (req, res) => {
    const result = await subscriptionPlanService.softDeleteSubscriptionPlan(req.params.id);
    return sendServiceResult(res, result);
};

const importRecords = async (req, res) => {
    const result = await subscriptionPlanService.importSubscriptionPlans(req.body.records);
    return sendServiceResult(res, result);
};

const getDropDown = async (req, res) => {
    const result = await subscriptionPlanService.listSubscriptionPlansForDropdown(req.query);
    return sendServiceResult(res, result);
};

module.exports = {
    getAll,
    create,
    update,
    getById,
    deleteSubscriptionPlan,
    importRecords,
    getDropDown,
};
