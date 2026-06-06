const {
  listPartnerOrders,
  getPartnerOrderById,
} = require('../../../services/mobile/partner/order_service');

const getCallerId = (req) => req.user?.id || req.user?._id;

const listOrdersHandler = async (req, res) => {
  try {
    const result = await listPartnerOrders(getCallerId(req), req.query);
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
      todayCount: result.data.data.todayCount,
      totalPages: result.data.data.totalPages,
      currentPage: result.data.data.currentPage,
      limit: result.data.data.limit,
      records: result.data.data.records,
    });
  } catch (error) {
    console.error('mobile partner order list handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getOrderDetailsHandler = async (req, res) => {
  try {
    const result = await getPartnerOrderById(getCallerId(req), req.params.orderId);
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
    console.error('mobile partner order details handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  listOrdersHandler,
  getOrderDetailsHandler,
};
