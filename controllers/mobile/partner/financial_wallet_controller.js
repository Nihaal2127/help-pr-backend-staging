const {
  listFinancialPayments,
  getFinancialPaymentById,
} = require('../../../services/mobile/partner/financial_payments_service');
const {
  getWalletSummary,
  listWalletTransactions,
} = require('../../../services/mobile/partner/wallet_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const listFinancialPaymentsHandler = wrapMobileHandler(
  'mobile partner financial payments list',
  async (req, res) => {
    const result = await listFinancialPayments(getCallerId(req), req.query);
    if (!result.ok) {
      return sendServiceError(res, result);
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
  }
);

const getFinancialPaymentHandler = wrapMobileHandler(
  'mobile partner financial payment get',
  async (req, res) => {
    const result = await getFinancialPaymentById(getCallerId(req), req.params.orderId);
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      record: result.data.record,
    });
  }
);

const getWalletSummaryHandler = wrapMobileHandler('mobile partner wallet summary', async (req, res) => {
  const result = await getWalletSummary(getCallerId(req));
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(200).json({
    success: true,
    status: 200,
    message: result.data.message,
    data: result.data.data,
  });
});

const listWalletTransactionsHandler = wrapMobileHandler(
  'mobile partner wallet transactions list',
  async (req, res) => {
    const result = await listWalletTransactions(getCallerId(req), req.query);
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      totalItems: result.data.totalItems,
      totalPages: result.data.totalPages,
      currentPage: result.data.currentPage,
      limit: result.data.limit,
      records: result.data.records,
    });
  }
);

module.exports = {
  listFinancialPaymentsHandler,
  getFinancialPaymentHandler,
  getWalletSummaryHandler,
  listWalletTransactionsHandler,
};
