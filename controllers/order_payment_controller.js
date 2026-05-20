const mongoose = require("mongoose");
const Order = require("../models/order");
const OrderPayment = require("../models/order_payment");
const { assertOrderModifyAccess } = require("../utils/order_access");
const { syncOrderPaymentStatus } = require("../services/order_payment_status_service");
const { syncPartnerOrderPaymentWallet } = require("../services/partner_wallet_order_service");
const { validatePartnerOrderPayment } = require("../services/partner_order_payment_validation");

const PAYER_TYPES = new Set(["customer", "partner"]);
const STATUSES = new Set(["pending", "completed", "failed", "refunded"]);

const create = async (req, res) => {
  try {
    const {
      order_id,
      payer_type,
      amount,
      payment_method,
      status,
      transaction_reference,
      installment_index,
      due_date,
      paid_at,
      notes,
    } = req.body;

    if (!order_id || !mongoose.Types.ObjectId.isValid(order_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Valid order_id is required.",
      });
    }
    if (!payer_type || !PAYER_TYPES.has(payer_type)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "payer_type must be customer or partner.",
      });
    }
    if (amount === undefined || Number(amount) < 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "amount is required and must be >= 0.",
      });
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

    const st = status && STATUSES.has(status) ? status : "pending";

    if (payer_type === "partner") {
      const partnerCheck = await validatePartnerOrderPayment(order, {
        amount: Number(amount),
        status: st,
      });
      if (!partnerCheck.ok) {
        return res.status(partnerCheck.status).json({
          success: false,
          status: partnerCheck.status,
          message: partnerCheck.message,
        });
      }
    }

    const doc = new OrderPayment({
      order_id: order._id,
      payer_type,
      amount: Number(amount),
      payment_method: payment_method != null ? String(payment_method) : "",
      status: st,
      transaction_reference: transaction_reference || "",
      installment_index:
        installment_index !== undefined && installment_index !== null
          ? Number(installment_index)
          : null,
      due_date: due_date ? new Date(due_date) : null,
      paid_at: paid_at ? new Date(paid_at) : null,
      notes: notes || "",
    });
    await doc.save();
    await syncPartnerOrderPaymentWallet(doc);

    const { order: syncedOrder, breakdown } = await syncOrderPaymentStatus(order._id);

    return res.status(201).json({
      success: true,
      status: 201,
      message: "Order payment record created.",
      record: doc,
      order_payment_status: breakdown.payment_status,
      order: {
        payment_status: syncedOrder.payment_status,
        is_paid: syncedOrder.is_paid,
        customer_due_amount: syncedOrder.customer_due_amount,
        total_price: syncedOrder.total_price,
      },
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

    const {
      amount,
      payment_method,
      status,
      transaction_reference,
      installment_index,
      due_date,
      paid_at,
      notes,
    } = req.body;

    if (amount !== undefined) {
      if (Number(amount) < 0) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "amount must be >= 0.",
        });
      }
      row.amount = Number(amount);
    }
    if (payment_method !== undefined) row.payment_method = String(payment_method);
    if (status !== undefined) {
      if (!STATUSES.has(status)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "Invalid status.",
        });
      }
      row.status = status;
    }
    if (transaction_reference !== undefined) {
      row.transaction_reference = transaction_reference;
    }
    if (installment_index !== undefined) {
      row.installment_index =
        installment_index === null ? null : Number(installment_index);
    }
    if (due_date !== undefined) {
      row.due_date = due_date ? new Date(due_date) : null;
    }
    if (paid_at !== undefined) {
      row.paid_at = paid_at ? new Date(paid_at) : null;
    }
    if (notes !== undefined) row.notes = notes;

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

    row.updated_at = new Date();
    await row.save();
    await syncPartnerOrderPaymentWallet(row);

    const { order: syncedOrder, breakdown } = await syncOrderPaymentStatus(order._id);

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Order payment updated.",
      record: row,
      order_payment_status: breakdown.payment_status,
      order: {
        payment_status: syncedOrder.payment_status,
        is_paid: syncedOrder.is_paid,
        customer_due_amount: syncedOrder.customer_due_amount,
        total_price: syncedOrder.total_price,
      },
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

    row.deleted_at = new Date();
    row.updated_at = new Date();
    await row.save();
    await syncPartnerOrderPaymentWallet(row);

    const { breakdown } = await syncOrderPaymentStatus(orderForAuth._id);

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

module.exports = { create, listByOrder, update, remove };
