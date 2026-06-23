const {
  listAllCustomerOrderPayments,
  listCustomerOrderPayments,
  createCustomerOrderPayment,
  updateCustomerOrderPayment,
  deleteCustomerOrderPayment,
  getCustomerOrderPaymentStatus,
} = require('../../../services/mobile/user/order_payment_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendPaginatedListFromData,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const listAllOrderPaymentsHandler = wrapMobileHandler(
  'mobile user list all order payments handler',
  async (req, res) => {
    const result = await listAllCustomerOrderPayments(getCallerId(req), req.query);
    return sendPaginatedListFromData(res, result, { includeTodayCount: false });
  }
);

const listOrderPaymentsHandler = wrapMobileHandler(
  'mobile user list order payments handler',
  async (req, res) => {
    const result = await listCustomerOrderPayments(getCallerId(req), req.params.orderId);
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      records: result.data.records,
    });
  }
);

const createOrderPaymentHandler = wrapMobileHandler(
  'mobile user create order payment handler',
  async (req, res) => {
    const result = await createCustomerOrderPayment(
      getCallerId(req),
      req.params.orderId,
      req.body
    );
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(result.status || 201).json({
      success: true,
      status: result.status || 201,
      message: result.data.message,
      record: result.data.record,
      order: result.data.order,
    });
  }
);

const updateOrderPaymentHandler = wrapMobileHandler(
  'mobile user update order payment handler',
  async (req, res) => {
    const result = await updateCustomerOrderPayment(
      getCallerId(req),
      req.params.orderId,
      req.params.paymentId,
      req.body
    );
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      record: result.data.record,
      order: result.data.order,
    });
  }
);

const deleteOrderPaymentHandler = wrapMobileHandler(
  'mobile user delete order payment handler',
  async (req, res) => {
    const result = await deleteCustomerOrderPayment(
      getCallerId(req),
      req.params.orderId,
      req.params.paymentId
    );
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      order_payment_status: result.data.order_payment_status,
    });
  }
);

const getOrderPaymentStatusHandler = wrapMobileHandler(
  'mobile user get order payment status handler',
  async (req, res) => {
    const result = await getCustomerOrderPaymentStatus(
      getCallerId(req),
      req.params.orderId,
      req.params.paymentId
    );
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      data: result.data.data,
    });
  }
);

module.exports = {
  listAllOrderPaymentsHandler,
  listOrderPaymentsHandler,
  createOrderPaymentHandler,
  updateOrderPaymentHandler,
  deleteOrderPaymentHandler,
  getOrderPaymentStatusHandler,
};
