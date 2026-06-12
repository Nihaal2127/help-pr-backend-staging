const {
  listCustomerOrders,
  getCustomerOrderById,
  getCustomerOrderInvoice,
} = require('../../../services/mobile/user/order_service');
const { submitOrderReview } = require('../../../services/mobile/user/order_review_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendPaginatedListFromData,
  sendRecordResult,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const listOrdersHandler = wrapMobileHandler('mobile user order list handler', async (req, res) => {
  const result = await listCustomerOrders(getCallerId(req), req.query);
  return sendPaginatedListFromData(res, result);
});

const getOrderDetailsHandler = wrapMobileHandler('mobile user order details handler', async (req, res) => {
  const result = await getCustomerOrderById(getCallerId(req), req.params.orderId);
  return sendRecordResult(res, result);
});

const downloadOrderInvoiceHandler = wrapMobileHandler(
  'mobile user download order invoice handler',
  async (req, res) => {
    const result = await getCustomerOrderInvoice(getCallerId(req), req.params.orderId);
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.data.filename}"`);
    return res.status(200).send(result.data.html);
  }
);

const submitOrderReviewHandler = wrapMobileHandler('mobile user submit order review handler', async (req, res) => {
  const result = await submitOrderReview(getCallerId(req), req.params.orderId, req.body);
  return sendRecordResult(res, result);
});

module.exports = {
  listOrdersHandler,
  getOrderDetailsHandler,
  downloadOrderInvoiceHandler,
  submitOrderReviewHandler,
};
