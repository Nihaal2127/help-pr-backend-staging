const {
  listPartnerOrderAdditionalCharges,
  createPartnerOrderAdditionalCharge,
  updatePartnerOrderAdditionalCharge,
  deletePartnerOrderAdditionalCharge,
} = require('../../../services/mobile/partner/order_additional_charge_service');

const getCallerId = (req) => req.user?.id || req.user?._id;

const listOrderAdditionalChargesHandler = async (req, res) => {
  try {
    const result = await listPartnerOrderAdditionalCharges(
      getCallerId(req),
      req.params.orderId
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
      records: result.data.records,
    });
  } catch (error) {
    console.error('mobile partner list order additional charges handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const createOrderAdditionalChargeHandler = async (req, res) => {
  try {
    const result = await createPartnerOrderAdditionalCharge(
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
    console.error('mobile partner create order additional charge handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const updateOrderAdditionalChargeHandler = async (req, res) => {
  try {
    const result = await updatePartnerOrderAdditionalCharge(
      getCallerId(req),
      req.params.orderId,
      req.params.chargeId,
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
    console.error('mobile partner update order additional charge handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const deleteOrderAdditionalChargeHandler = async (req, res) => {
  try {
    const result = await deletePartnerOrderAdditionalCharge(
      getCallerId(req),
      req.params.orderId,
      req.params.chargeId
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
      order: result.data.order,
    });
  } catch (error) {
    console.error('mobile partner delete order additional charge handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  listOrderAdditionalChargesHandler,
  createOrderAdditionalChargeHandler,
  updateOrderAdditionalChargeHandler,
  deleteOrderAdditionalChargeHandler,
};
