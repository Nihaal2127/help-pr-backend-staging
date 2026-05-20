const mongoose = require("mongoose");
const Order = require("../models/order");
const OrderAdditionalCharge = require("../models/order_additional_charge");
const { recalculateOrderTotals } = require("../utils/order_financials");
const { computeAdditionalChargeLine } = require("../utils/order_pricing");
const { assertOrderModifyAccess } = require("../utils/order_access");

const ALLOWED_METHODS = new Set([
  "cash",
  "upi",
  "card",
  "online",
  "bank_transfer",
  "other",
]);

const create = async (req, res) => {
  try {
    const {
      order_id,
      label,
      description,
      amount,
      payment_method,
      charge_type,
    } = req.body;

    if (!order_id || !mongoose.Types.ObjectId.isValid(order_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Valid order_id is required.",
      });
    }
    if (amount === undefined || Number(amount) < 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "amount is required and must be >= 0.",
      });
    }

    const order = await Order.findOne({
      _id: order_id,
      deleted_at: null,
    });
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
          "You are not allowed to modify charges on this order.",
      });
    }

    const method =
      payment_method && ALLOWED_METHODS.has(String(payment_method).toLowerCase())
        ? String(payment_method).toLowerCase()
        : "other";

    const taxPercent = Number(order.tax_percent) || 0;
    const commissionPercent = Number(order.commission_percent) || 0;
    const chargeLine = computeAdditionalChargeLine(
      amount,
      taxPercent,
      commissionPercent
    );

    const doc = new OrderAdditionalCharge({
      order_id: order._id,
      label: label || "",
      description: description || "",
      amount: chargeLine.amount,
      commission_percent: chargeLine.commission_percent,
      commission_amount: chargeLine.commission_amount,
      tax_percent: chargeLine.tax_percent,
      tax_amount: chargeLine.tax_amount,
      total_amount: chargeLine.total_amount,
      payment_method: method,
      charge_type: charge_type || "misc",
    });
    await doc.save();
    await recalculateOrderTotals(order._id);

    return res.status(201).json({
      success: true,
      status: 201,
      message: "Additional charge added and order total updated.",
      record: doc,
    });
  } catch (error) {
    console.error("order_additional_charge create:", error);
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

    const rows = await OrderAdditionalCharge.find({
      order_id: orderId,
      deleted_at: null,
    }).sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Additional charges fetched.",
      records: rows,
    });
  } catch (error) {
    console.error("order_additional_charge listByOrder:", error);
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

    const row = await OrderAdditionalCharge.findOne({
      _id: id,
      deleted_at: null,
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Charge not found.",
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

    const { label, description, amount, payment_method, charge_type } = req.body;
    if (label !== undefined) row.label = label;
    if (description !== undefined) row.description = description;
    if (amount !== undefined) {
      if (Number(amount) < 0) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "amount must be >= 0.",
        });
      }
      const taxPercent = Number(order.tax_percent) || 0;
      const commissionPercent = Number(order.commission_percent) || 0;
      const chargeLine = computeAdditionalChargeLine(
        amount,
        taxPercent,
        commissionPercent
      );
      row.amount = chargeLine.amount;
      row.commission_percent = chargeLine.commission_percent;
      row.commission_amount = chargeLine.commission_amount;
      row.tax_percent = chargeLine.tax_percent;
      row.tax_amount = chargeLine.tax_amount;
      row.total_amount = chargeLine.total_amount;
    }
    if (payment_method !== undefined) {
      const m = String(payment_method).toLowerCase();
      row.payment_method = ALLOWED_METHODS.has(m) ? m : "other";
    }
    if (charge_type !== undefined) row.charge_type = charge_type;
    row.updated_at = new Date();
    await row.save();
    await recalculateOrderTotals(row.order_id);

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Charge updated and order total refreshed.",
      record: row,
    });
  } catch (error) {
    console.error("order_additional_charge update:", error);
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

    const row = await OrderAdditionalCharge.findOne({
      _id: id,
      deleted_at: null,
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Charge not found.",
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
    const orderId = row.order_id;
    await recalculateOrderTotals(orderId);

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Charge removed and order total refreshed.",
    });
  } catch (error) {
    console.error("order_additional_charge remove:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

module.exports = { create, listByOrder, update, remove };
