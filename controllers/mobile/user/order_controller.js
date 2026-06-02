const { listCustomerOrders } = require('../../../services/mobile/user/order_service');
const { submitOrderReview } = require('../../../services/mobile/user/order_review_service');

const getCallerId = (req) => req.user?.id || req.user?._id;

const listOrdersHandler = async (req, res) => {
  try {
    const result = await listCustomerOrders(getCallerId(req), req.query);
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
      totalItems: result.data.data.totalItems,
      totalPages: result.data.data.totalPages,
      currentPage: result.data.data.currentPage,
      limit: result.data.data.limit,
      records: result.data.data.records,
    });
  } catch (error) {
    console.error('mobile user order list handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const submitOrderReviewHandler = async (req, res) => {
  try {
    const result = await submitOrderReview(getCallerId(req), req.params.orderId, req.body);
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
      record: result.data.record,
    });
  } catch (error) {
    console.error('mobile user submit order review handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  listOrdersHandler,
  submitOrderReviewHandler,
};
