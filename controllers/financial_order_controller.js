const financialOrderService = require('../services/financial_order_service');

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
    const result = await financialOrderService.listFinancialOrders(req.query);
    return sendServiceResult(res, result);
};

const create = async (req, res) => {
    const result = await financialOrderService.createFinancialOrder(req.body);
    return sendServiceResult(res, result);
};

const update = async (req, res) => {
    const result = await financialOrderService.updateFinancialOrder(req.params.id, req.body);
    return sendServiceResult(res, result);
};

const getById = async (req, res) => {
    const result = await financialOrderService.getFinancialOrderById(req.params.id);
    return sendServiceResult(res, result);
};

const deleteFinancialOrder = async (req, res) => {
    const result = await financialOrderService.softDeleteFinancialOrder(req.params.id);
    return sendServiceResult(res, result);
};

module.exports = {
    getAll,
    create,
    update,
    getById,
    deleteFinancialOrder,
};
