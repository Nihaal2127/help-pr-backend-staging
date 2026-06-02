const {
  createCustomerQuote,
  listCustomerQuotes,
  getCustomerQuoteById,
  updateCustomerQuote,
  cancelCustomerQuote,
  convertCustomerQuoteToOrder,
} = require('../../../services/mobile/user/quote_service');

const getCallerId = (req) => req.user?.id || req.user?._id;

const sendResult = (res, result) => {
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      status: result.status,
      message: result.message,
    });
  }

  const payload = {
    success: true,
    status: result.status,
    message: result.data.message,
  };

  if (result.data.data !== undefined) {
    payload.data = result.data.data;
  }
  if (result.data.totalItems !== undefined) {
    payload.totalItems = result.data.totalItems;
    payload.totalPages = result.data.totalPages;
    payload.currentPage = result.data.currentPage;
    payload.limit = result.data.limit;
    if (result.data.records) {
      payload.records = result.data.records;
    }
  }

  return res.status(result.status).json(payload);
};

const createQuoteHandler = async (req, res) => {
  try {
    const result = await createCustomerQuote(getCallerId(req), req.body);
    return sendResult(res, result);
  } catch (error) {
    console.error('mobile user quote create handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const listQuotesHandler = async (req, res) => {
  try {
    const result = await listCustomerQuotes(getCallerId(req), req.query);
    if (!result.ok) {
      return sendResult(res, result);
    }
    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      totalItems: result.data.data.totalItems,
      totalPages: result.data.data.totalPages,
      currentPage: result.data.data.currentPage,
      limit: result.data.data.limit,
      records: result.data.data.records,
    });
  } catch (error) {
    console.error('mobile user quote list handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getQuoteHandler = async (req, res) => {
  try {
    const result = await getCustomerQuoteById(getCallerId(req), req.params.id);
    return sendResult(res, result);
  } catch (error) {
    console.error('mobile user quote get handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const updateQuoteHandler = async (req, res) => {
  try {
    const result = await updateCustomerQuote(
      getCallerId(req),
      req.params.id,
      req.body
    );
    return sendResult(res, result);
  } catch (error) {
    console.error('mobile user quote update handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const cancelQuoteHandler = async (req, res) => {
  try {
    const result = await cancelCustomerQuote(
      getCallerId(req),
      req.params.id,
      req.body || {}
    );
    return sendResult(res, result);
  } catch (error) {
    console.error('mobile user quote cancel handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const convertQuoteToOrderHandler = async (req, res) => {
  try {
    const result = await convertCustomerQuoteToOrder(
      getCallerId(req),
      req.params.id,
      req.body || {}
    );
    return sendResult(res, result);
  } catch (error) {
    console.error('mobile user quote convert handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  createQuoteHandler,
  listQuotesHandler,
  getQuoteHandler,
  updateQuoteHandler,
  cancelQuoteHandler,
  convertQuoteToOrderHandler,
};
