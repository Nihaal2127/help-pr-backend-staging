const mongoose = require("mongoose");
const Order = require("../models/order");
const OrderPayment = require("../models/order_payment");
const { assertOrderModifyAccess } = require("../utils/order_access");
const { validatePartnerOrderPayment } = require("../services/partner_order_payment_validation");
const { fieldLabel } = require("../utils/field_labels");
const {
  PAYER_TYPES,
  PAYMENT_STATUSES,
  applyOrderPaymentFieldUpdates,
  commitOrderPaymentUpdate,
  softDeleteOrderPaymentRecord,
  formatAdminOrderPaymentSummary,
} = require("../services/order_payment_crud_service");
const {
  createAdminOrderPayment,
  getAdminOrderPaymentStatus,
} = require("../services/admin_order_payment_service");

const create = async (req, res) => {
  try {
    const {
      order_id,
      payer_type,
      amount,
      status,
    } = req.body;

    if (!order_id || !mongoose.Types.ObjectId.isValid(order_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `Valid ${fieldLabel("order_id")} is required.`,
      });
    }
    if (!payer_type || !PAYER_TYPES.has(payer_type)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `${fieldLabel("payer_type")} must be customer or partner.`,
      });
    }
    if (amount === undefined || Number(amount) < 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "amount is required and must be >= 0.",
      });
    }

    const paymentMethod =
      req.body.payment_method !== undefined
        ? String(req.body.payment_method).trim().toLowerCase()
        : "";
    if (paymentMethod === "online") {
      if (payer_type !== "customer") {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "Online payments are only supported for payer_type customer.",
        });
      }
      if (Number(amount) <= 0) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "amount must be greater than 0 for online payments.",
        });
      }
      if (status === "completed") {
        return res.status(400).json({
          success: false,
          status: 400,
          message:
            "Online payments cannot be marked completed until Razorpay confirms payment.",
        });
      }
    }

    const order = await Order.findOne({ _id: order_id, deleted_at: null });
    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Order not found.",
      });
    }

    const access = await assertOrderModifyAccess(req, order);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message:
          access.message ||
          "You are not allowed to record payments on this order.",
      });
    }

    const result = await createAdminOrderPayment(order, req.body);
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    const httpStatus = result.status || 201;
    return res.status(httpStatus).json({
      success: true,
      status: httpStatus,
      message: result.data.message,
      record: result.data.record,
      order_payment_status: result.data.order_payment_status,
      order: result.data.order,
    });
  } catch (error) {
    console.error("order_payment create:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const paymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid payment id.",
      });
    }

    const payment = await OrderPayment.findOne({ _id: id, deleted_at: null });
    if (!payment) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Payment not found.",
      });
    }

    const order = await Order.findOne({ _id: payment.order_id, deleted_at: null });
    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Order not found.",
      });
    }

    const access = await assertOrderModifyAccess(req, order);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message || "Forbidden.",
      });
    }

    const result = await getAdminOrderPaymentStatus(id);
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
      data: result.data.data,
    });
  } catch (error) {
    console.error("order_payment paymentStatus:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const listByOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid order id.",
      });
    }

    const order = await Order.findOne({ _id: orderId, deleted_at: null });
    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Order not found.",
      });
    }
    const access = await assertOrderModifyAccess(req, order);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message || "Forbidden.",
      });
    }

    const payer_type = req.query.payer_type;
    const filter = { order_id: orderId, deleted_at: null };
    if (payer_type && PAYER_TYPES.has(payer_type)) {
      filter.payer_type = payer_type;
    }

    const rows = await OrderPayment.find(filter).sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Order payments fetched.",
      records: rows,
    });
  } catch (error) {
    console.error("order_payment listByOrder:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid id.",
      });
    }

    const row = await OrderPayment.findOne({ _id: id, deleted_at: null });
    if (!row) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Payment not found.",
      });
    }

    const order = await Order.findOne({ _id: row.order_id, deleted_at: null });
    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Order not found.",
      });
    }
    const access = await assertOrderModifyAccess(req, order);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message || "Forbidden.",
      });
    }

    const { amount } = req.body;

    if (amount !== undefined) {
      if (Number(amount) < 0) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "amount must be >= 0.",
        });
      }
    }

    const fieldUpdateResult = applyOrderPaymentFieldUpdates(row, req.body, {
      validateStatus: true,
      trimStrings: false,
    });
    if (!fieldUpdateResult.ok) {
      return res.status(fieldUpdateResult.status).json({
        success: false,
        status: fieldUpdateResult.status,
        message: fieldUpdateResult.message,
      });
    }

    if (row.payer_type === "partner") {
      const partnerCheck = await validatePartnerOrderPayment(order, {
        amount: row.amount,
        status: row.status,
        excludePaymentId: row._id,
      });
      if (!partnerCheck.ok) {
        return res.status(partnerCheck.status).json({
          success: false,
          status: partnerCheck.status,
          message: partnerCheck.message,
        });
      }
    }

    const updateResult = await commitOrderPaymentUpdate(row, order._id);
    const syncedOrder = updateResult.syncResult?.order;
    const breakdown = updateResult.syncResult?.breakdown;

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Order payment updated.",
      record: updateResult.row,
      order_payment_status: breakdown.payment_status,
      order: formatAdminOrderPaymentSummary(syncedOrder),
    });
  } catch (error) {
    console.error("order_payment update:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const remove = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid id.",
      });
    }

    const row = await OrderPayment.findOne({ _id: id, deleted_at: null });
    if (!row) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Payment not found.",
      });
    }

    const orderForAuth = await Order.findOne({ _id: row.order_id, deleted_at: null });
    if (!orderForAuth) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Order not found.",
      });
    }
    const access = await assertOrderModifyAccess(req, orderForAuth);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message || "Forbidden.",
      });
    }

    const syncResult = await softDeleteOrderPaymentRecord(row, orderForAuth._id);
    const breakdown = syncResult?.breakdown;

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Order payment soft-deleted.",
      order_payment_status: breakdown.payment_status,
    });
  } catch (error) {
    console.error("order_payment remove:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

module.exports = { create, listByOrder, update, remove, paymentStatus };
