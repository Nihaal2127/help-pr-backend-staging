const mongoose = require("mongoose");
const Order = require("../models/order");
const OrderAdditionalCharge = require("../models/order_additional_charge");
const { assertOrderModifyAccess } = require("../utils/order_access");
const { fieldLabel } = require("../utils/field_labels");
const {
  listActiveChargesByOrder,
  createAdditionalCharge,
  updateAdditionalCharge,
  deleteAdditionalCharge,
} = require("../services/order_additional_charge_service");

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
        message: `Valid ${fieldLabel("order_id")} is required.`,
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

    const doc = await createAdditionalCharge(order, {
      label,
      description,
      amount,
      payment_method,
      charge_type,
    });

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

    const rows = await listActiveChargesByOrder(orderId);

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
    if (amount !== undefined && Number(amount) < 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "amount must be >= 0.",
      });
    }

    const updated = await updateAdditionalCharge(order, row, {
      label,
      description,
      amount,
      payment_method,
      charge_type,
    });

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Charge updated and order total refreshed.",
      record: updated,
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

    await deleteAdditionalCharge(row);

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
