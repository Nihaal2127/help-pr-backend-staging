const {
    listFinancialOrderPayments,
    getFinancialOrderPaymentById,
} = require('../services/order_financial_payments_service');

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

const getFinancialPaymentsAll = async (req, res) => {
    const result = await listFinancialOrderPayments(req);
    return sendServiceResult(res, result);
};

const getFinancialPaymentById = async (req, res) => {
    const result = await getFinancialOrderPaymentById(req, req.params.id);
    return sendServiceResult(res, result);
};

module.exports = {
    getFinancialPaymentsAll,
    getFinancialPaymentById,
};
