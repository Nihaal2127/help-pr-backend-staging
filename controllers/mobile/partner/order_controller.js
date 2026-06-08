const {
  listPartnerOrders,
  getPartnerOrderById,
} = require('../../../services/mobile/partner/order_service');
const {
  updatePartnerWorkStatus,
  completePartnerOrderWork,
} = require('../../../services/mobile/partner/order_work_service');

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

const updateWorkStatusHandler = async (req, res) => {
  try {
    const result = await updatePartnerWorkStatus(
      getCallerId(req),
      req.params.orderId,
      req.body
    );
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
    console.error('mobile partner update work status handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const completeOrderWorkHandler = async (req, res) => {
  try {
    const result = await completePartnerOrderWork(
      getCallerId(req),
      req.params.orderId,
      req.body,
      req.files
    );
    if (!result.ok) {
      const payload = {
        success: false,
        status: result.status,
        message: result.message,
      };
      if (result.breakdown) {
        payload.breakdown = result.breakdown;
      }
      return res.status(result.status).json(payload);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      record: result.data.record,
      post: result.data.post ?? null,
      post_error: result.data.post_error ?? null,
    });
  } catch (error) {
    console.error('mobile partner complete order work handler', error.message);
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
  updateWorkStatusHandler,
  completeOrderWorkHandler,
};
