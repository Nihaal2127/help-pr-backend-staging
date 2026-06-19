const {
  listPartnerOrders,
  getPartnerOrderById,
  getPartnerOrderInvoice,
} = require('../../../services/mobile/partner/order_service');
const {
  updatePartnerWorkStatus,
  completePartnerOrderWork,
} = require('../../../services/mobile/partner/order_work_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendPaginatedListFromData,
  sendRecordResult,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const listOrdersHandler = wrapMobileHandler('mobile partner order list handler', async (req, res) => {
  const result = await listPartnerOrders(getCallerId(req), req.query);
  return sendPaginatedListFromData(res, result);
});

const getOrderDetailsHandler = wrapMobileHandler('mobile partner order details handler', async (req, res) => {
  const result = await getPartnerOrderById(getCallerId(req), req.params.orderId);
  return sendRecordResult(res, result);
});

const downloadOrderInvoiceHandler = wrapMobileHandler(
  'mobile partner download order invoice handler',
  async (req, res) => {
    const result = await getPartnerOrderInvoice(getCallerId(req), req.params.orderId);
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.data.filename}"`);
    return res.status(200).send(result.data.html);
  }
);

const updateWorkStatusHandler = wrapMobileHandler('mobile partner update work status handler', async (req, res) => {
  const result = await updatePartnerWorkStatus(
    getCallerId(req),
    req.params.orderId,
    req.body
  );
  return sendRecordResult(res, result);
});

const completeOrderWorkHandler = wrapMobileHandler('mobile partner complete order work handler', async (req, res) => {
  const result = await completePartnerOrderWork(
    getCallerId(req),
    req.params.orderId,
    req.body,
    req.files
  );
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(200).json({
    success: true,
    status: 200,
    message: result.data.message,
    record: result.data.record,
    post: result.data.post ?? null,
    post_error: result.data.post_error ?? null,
  });
});

module.exports = {
  listOrdersHandler,
  getOrderDetailsHandler,
  downloadOrderInvoiceHandler,
  updateWorkStatusHandler,
  completeOrderWorkHandler,
};
