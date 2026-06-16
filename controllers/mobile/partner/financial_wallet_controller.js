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
      source: result.data.source,
      record: result.data.record,
      partner_summary: result.data.partner_summary,
      order_payments: result.data.order_payments,
    });
  }
);

const getWalletSummaryHandler = wrapMobileHandler('mobile partner wallet summary', async (req, res) => {
  const result = await getWalletSummary(getCallerId(req), req.query);
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
      wallet_balance: result.data.wallet_balance,
      partner: result.data.partner,
      totals: result.data.totals,
      records: result.data.records,
      totalPages: result.data.totalPages,
      totalItems: result.data.totalItems,
      currentPage: result.data.currentPage,
      limit: result.data.limit,
    });
  }
);

module.exports = {
  listFinancialPaymentsHandler,
  getFinancialPaymentHandler,
  getWalletSummaryHandler,
  listWalletTransactionsHandler,
};
