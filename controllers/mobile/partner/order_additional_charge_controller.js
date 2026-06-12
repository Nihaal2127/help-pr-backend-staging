const {
  listPartnerOrderAdditionalCharges,
  createPartnerOrderAdditionalCharge,
  updatePartnerOrderAdditionalCharge,
  deletePartnerOrderAdditionalCharge,
} = require('../../../services/mobile/partner/order_additional_charge_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const listOrderAdditionalChargesHandler = wrapMobileHandler(
  'mobile partner list order additional charges handler',
  async (req, res) => {
    const result = await listPartnerOrderAdditionalCharges(getCallerId(req), req.params.orderId);
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      records: result.data.records,
      partner_summary: result.data.partner_summary,
    });
  }
);

const createOrderAdditionalChargeHandler = wrapMobileHandler(
  'mobile partner create order additional charge handler',
  async (req, res) => {
    const result = await createPartnerOrderAdditionalCharge(
      getCallerId(req),
      req.params.orderId,
      req.body
    );
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(201).json({
      success: true,
      status: 201,
      message: result.data.message,
      record: result.data.record,
      order: result.data.order,
      partner_summary: result.data.partner_summary,
    });
  }
);

const updateOrderAdditionalChargeHandler = wrapMobileHandler(
  'mobile partner update order additional charge handler',
  async (req, res) => {
    const result = await updatePartnerOrderAdditionalCharge(
      getCallerId(req),
      req.params.orderId,
      req.params.chargeId,
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
      partner_summary: result.data.partner_summary,
    });
  }
);

const deleteOrderAdditionalChargeHandler = wrapMobileHandler(
  'mobile partner delete order additional charge handler',
  async (req, res) => {
    const result = await deletePartnerOrderAdditionalCharge(
      getCallerId(req),
      req.params.orderId,
      req.params.chargeId
    );
    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      order: result.data.order,
      partner_summary: result.data.partner_summary,
    });
  }
);

module.exports = {
  listOrderAdditionalChargesHandler,
  createOrderAdditionalChargeHandler,
  updateOrderAdditionalChargeHandler,
  deleteOrderAdditionalChargeHandler,
};
