const {
  createCustomerQuote,
  listCustomerQuotes,
  getCustomerQuoteById,
  updateCustomerQuote,
  cancelCustomerQuote,
  convertCustomerQuoteToOrder,
} = require('../../../services/mobile/user/quote_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendServiceResult,
  sendPaginatedListFromData,
} = require('../../../utils/mobile_controller_helpers');

const createQuoteHandler = wrapMobileHandler('mobile user quote create handler', async (req, res) => {
  const result = await createCustomerQuote(getCallerId(req), req.body);
  return sendServiceResult(res, result);
});

const listQuotesHandler = wrapMobileHandler('mobile user quote list handler', async (req, res) => {
  const result = await listCustomerQuotes(getCallerId(req), req.query);
  return sendPaginatedListFromData(res, result);
});

const getQuoteHandler = wrapMobileHandler('mobile user quote get handler', async (req, res) => {
  const result = await getCustomerQuoteById(getCallerId(req), req.params.id);
  return sendServiceResult(res, result);
});

const updateQuoteHandler = wrapMobileHandler('mobile user quote update handler', async (req, res) => {
  const result = await updateCustomerQuote(getCallerId(req), req.params.id, req.body);
  return sendServiceResult(res, result);
});

const cancelQuoteHandler = wrapMobileHandler('mobile user quote cancel handler', async (req, res) => {
  const result = await cancelCustomerQuote(getCallerId(req), req.params.id, req.body || {});
  return sendServiceResult(res, result);
});

const convertQuoteToOrderHandler = wrapMobileHandler('mobile user quote convert handler', async (req, res) => {
  const result = await convertCustomerQuoteToOrder(getCallerId(req), req.params.id, req.body || {});
  return sendServiceResult(res, result);
});

module.exports = {
  createQuoteHandler,
  listQuotesHandler,
  getQuoteHandler,
  updateQuoteHandler,
  cancelQuoteHandler,
  convertQuoteToOrderHandler,
};
