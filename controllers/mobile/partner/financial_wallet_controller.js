const {
    listFinancialPayments,
    getFinancialPaymentById,
} = require('../../../services/mobile/partner/financial_payments_service');
const {
    getWalletSummary,
    listWalletTransactions,
} = require('../../../services/mobile/partner/wallet_service');

const getCallerId = (req) => req.user?.id || req.user?._id;

const listFinancialPaymentsHandler = async (req, res) => {
    try {
        const result = await listFinancialPayments(getCallerId(req), req.query);
        if (!result.ok) {
            return res.status(result.status).json({
                success: false,
                status: result.status,
                message: result.message,
            });
        }

        return res.status(200).json({
            success: true,
            status: 200,
            message: result.data.message,
            source: result.data.source,
            totalItems: result.data.totalItems,
            totalPages: result.data.totalPages,
            currentPage: result.data.currentPage,
            totals: result.data.totals,
            records: result.data.records,
        });
    } catch (error) {
        console.error('mobile partner financial payments list', error.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const getFinancialPaymentHandler = async (req, res) => {
    try {
        const result = await getFinancialPaymentById(getCallerId(req), req.params.orderId);
        if (!result.ok) {
            return res.status(result.status).json({
                success: false,
                status: result.status,
                message: result.message,
            });
        }

        return res.status(200).json({
            success: true,
            status: 200,
            message: result.data.message,
            source: result.data.source,
            record: result.data.record,
        });
    } catch (error) {
        console.error('mobile partner financial payment detail', error.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const getWalletSummaryHandler = async (req, res) => {
    try {
        const result = await getWalletSummary(getCallerId(req), req.query);
        if (!result.ok) {
            return res.status(result.status).json({
                success: false,
                status: result.status,
                message: result.message,
            });
        }

        return res.status(200).json({
            success: true,
            status: 200,
            message: result.data.message,
            data: result.data.data,
        });
    } catch (error) {
        console.error('mobile partner wallet summary', error.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const listWalletTransactionsHandler = async (req, res) => {
    try {
        const result = await listWalletTransactions(getCallerId(req), req.query);
        if (!result.ok) {
            return res.status(result.status).json({
                success: false,
                status: result.status,
                message: result.message,
            });
        }

        return res.status(200).json({
            success: true,
            status: 200,
            message: result.data.message,
            data: result.data.data,
        });
    } catch (error) {
        console.error('mobile partner wallet transactions', error.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

module.exports = {
    listFinancialPaymentsHandler,
    getFinancialPaymentHandler,
    getWalletSummaryHandler,
    listWalletTransactionsHandler,
};
