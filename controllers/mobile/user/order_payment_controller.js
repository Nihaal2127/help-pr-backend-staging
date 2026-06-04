const {
  listCustomerOrderPayments,
  createCustomerOrderPayment,
  updateCustomerOrderPayment,
  deleteCustomerOrderPayment,
} = require('../../../services/mobile/user/order_payment_service');

const getCallerId = (req) => req.user?.id || req.user?._id;

const listOrderPaymentsHandler = async (req, res) => {
  try {
    const result = await listCustomerOrderPayments(getCallerId(req), req.params.orderId);
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
      records: result.data.records,
    });
  } catch (error) {
    console.error('mobile user list order payments handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const createOrderPaymentHandler = async (req, res) => {
  try {
    const result = await createCustomerOrderPayment(
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

    return res.status(201).json({
      success: true,
      status: 201,
      message: result.data.message,
      record: result.data.record,
      order: result.data.order,
    });
  } catch (error) {
    console.error('mobile user create order payment handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const updateOrderPaymentHandler = async (req, res) => {
  try {
    const result = await updateCustomerOrderPayment(
      getCallerId(req),
      req.params.orderId,
      req.params.paymentId,
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
      order: result.data.order,
    });
  } catch (error) {
    console.error('mobile user update order payment handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const deleteOrderPaymentHandler = async (req, res) => {
  try {
    const result = await deleteCustomerOrderPayment(
      getCallerId(req),
      req.params.orderId,
      req.params.paymentId
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
      order_payment_status: result.data.order_payment_status,
    });
  } catch (error) {
    console.error('mobile user delete order payment handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  listOrderPaymentsHandler,
  createOrderPaymentHandler,
  updateOrderPaymentHandler,
  deleteOrderPaymentHandler,
};
