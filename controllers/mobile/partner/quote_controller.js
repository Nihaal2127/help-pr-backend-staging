const {
  listPartnerQuotes,
  getPartnerQuoteById,
  updatePartnerQuoteStatus,
} = require('../../../services/mobile/partner/quote_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendPaginatedListFromData,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const listQuotesHandler = wrapMobileHandler('mobile partner quote list handler', async (req, res) => {
  const result = await listPartnerQuotes(getCallerId(req), req.query);
  return sendPaginatedListFromData(res, result, { includeTodayCount: false });
});

const getQuoteHandler = wrapMobileHandler('mobile partner quote get handler', async (req, res) => {
  const result = await getPartnerQuoteById(getCallerId(req), req.params.id);
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

const updateQuoteStatusHandler = wrapMobileHandler('mobile partner quote status handler', async (req, res) => {
  const result = await updatePartnerQuoteStatus(getCallerId(req), req.params.id, req.body);
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

module.exports = {
  listQuotesHandler,
  getQuoteHandler,
  updateQuoteStatusHandler,
};
