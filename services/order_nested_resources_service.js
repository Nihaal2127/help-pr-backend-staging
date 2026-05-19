const mongoose = require("mongoose");
const OrderAdditionalCharge = require("../models/order_additional_charge");
const OrderPayment = require("../models/order_payment");
const { OrderCreationError } = require("../errors/order_creation_error");
const { computeAdditionalChargeLine } = require("../utils/order_pricing");
const { recalculateOrderTotals } = require("../utils/order_financials");
const { syncOrderPaymentStatus } = require("../services/order_payment_status_service");

const ALLOWED_CHARGE_METHODS = new Set([
  "cash",
  "upi",
  "card",
  "online",
  "bank_transfer",
  "other",
]);

const PAYER_TYPES = new Set(["customer", "partner"]);
const PAYMENT_STATUSES = new Set(["pending", "completed", "failed", "refunded"]);

const resolveChargePaymentMethod = (payment_method) => {
  if (
    payment_method &&
    ALLOWED_CHARGE_METHODS.has(String(payment_method).toLowerCase())
  ) {
    return String(payment_method).toLowerCase();
  }
  return "other";
};

const resolvePaymentStatus = (status) => {
  if (status && PAYMENT_STATUSES.has(status)) return status;
  return "pending";
};

/**
 * Normalize nested field: array → { create, update: [], delete: [] }
 * object → { create, update, delete } with defaults.
 */
const normalizeNestedOps = (value, fieldName) => {
  if (value === undefined || value === null) {
    return { create: [], update: [], delete: [] };
  }
  if (Array.isArray(value)) {
    return { create: value, update: [], delete: [] };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return {
      create: Array.isArray(value.create) ? value.create : [],
      update: Array.isArray(value.update) ? value.update : [],
      delete: Array.isArray(value.delete) ? value.delete : [],
    };
  }
  throw new OrderCreationError(
    `${fieldName} must be an array or an object with create, update, and delete.`,
    400
  );
};

const validateChargeItem = (item, context) => {
  if (!item || typeof item !== "object") {
    throw new OrderCreationError(`${context}: invalid charge item.`, 400);
  }
  if (item.amount === undefined || Number(item.amount) < 0) {
    throw new OrderCreationError(
      `${context}: amount is required and must be >= 0.`,
      400
    );
  }
};

const validatePaymentItem = (item, context) => {
  if (!item || typeof item !== "object") {
    throw new OrderCreationError(`${context}: invalid payment item.`, 400);
  }
  if (!item.payer_type || !PAYER_TYPES.has(item.payer_type)) {
    throw new OrderCreationError(
      `${context}: payer_type must be customer or partner.`,
      400
    );
  }
  if (item.amount === undefined || Number(item.amount) < 0) {
    throw new OrderCreationError(
      `${context}: amount is required and must be >= 0.`,
      400
    );
  }
  if (item.status !== undefined && !PAYMENT_STATUSES.has(item.status)) {
    throw new OrderCreationError(`${context}: invalid payment status.`, 400);
  }
};

const resolveRowId = (raw) => {
  const id = raw?._id ?? raw?.id ?? raw;
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
    return null;
  }
  return new mongoose.Types.ObjectId(String(id));
};

const buildChargeDocument = (order, item) => {
  const taxPercent = Number(order.tax_percent) || 0;
  const chargeLine = computeAdditionalChargeLine(item.amount, taxPercent);
  return {
    order_id: order._id,
    label: item.label || "",
    description: item.description || "",
    amount: chargeLine.amount,
    tax_percent: chargeLine.tax_percent,
    tax_amount: chargeLine.tax_amount,
    total_amount: chargeLine.total_amount,
    payment_method: resolveChargePaymentMethod(item.payment_method),
    charge_type: item.charge_type || "misc",
  };
};

const buildPaymentDocument = (order, item) => ({
  order_id: order._id,
  payer_type: item.payer_type,
  amount: Number(item.amount),
  payment_method: item.payment_method != null ? String(item.payment_method) : "",
  status: resolvePaymentStatus(item.status),
  transaction_reference: item.transaction_reference || "",
  installment_index:
    item.installment_index !== undefined && item.installment_index !== null
      ? Number(item.installment_index)
      : null,
  due_date: item.due_date ? new Date(item.due_date) : null,
  paid_at: item.paid_at ? new Date(item.paid_at) : null,
  notes: item.notes || "",
});

const hasNestedPayload = (body) =>
  body &&
  (body.additional_charges !== undefined || body.order_payments !== undefined);

const applyChargeCreates = async (order, items) => {
  const created = [];
  for (let i = 0; i < items.length; i += 1) {
    validateChargeItem(items[i], `additional_charges.create[${i}]`);
    const doc = new OrderAdditionalCharge(buildChargeDocument(order, items[i]));
    await doc.save();
    created.push(doc);
  }
  return created;
};

const applyPaymentCreates = async (order, items) => {
  const created = [];
  for (let i = 0; i < items.length; i += 1) {
    validatePaymentItem(items[i], `order_payments.create[${i}]`);
    const doc = new OrderPayment(buildPaymentDocument(order, items[i]));
    await doc.save();
    created.push(doc);
  }
  return created;
};

const softDeleteCharges = async (orderId, deleteIds) => {
  const deleted = [];
  for (const rawId of deleteIds) {
    const oid = resolveRowId(rawId);
    if (!oid) {
      throw new OrderCreationError("additional_charges.delete: invalid id.", 400);
    }
    const row = await OrderAdditionalCharge.findOne({
      _id: oid,
      order_id: orderId,
      deleted_at: null,
    });
    if (!row) {
      throw new OrderCreationError(
        `additional_charges.delete: charge ${oid} not found on this order.`,
        404
      );
    }
    row.deleted_at = new Date();
    row.updated_at = new Date();
    await row.save();
    deleted.push(oid);
  }
  return deleted;
};

const softDeletePayments = async (orderId, deleteIds) => {
  const deleted = [];
  for (const rawId of deleteIds) {
    const oid = resolveRowId(rawId);
    if (!oid) {
      throw new OrderCreationError("order_payments.delete: invalid id.", 400);
    }
    const row = await OrderPayment.findOne({
      _id: oid,
      order_id: orderId,
      deleted_at: null,
    });
    if (!row) {
      throw new OrderCreationError(
        `order_payments.delete: payment ${oid} not found on this order.`,
        404
      );
    }
    row.deleted_at = new Date();
    row.updated_at = new Date();
    await row.save();
    deleted.push(oid);
  }
  return deleted;
};

const applyChargeUpdates = async (order, items) => {
  const updated = [];
  const taxPercent = Number(order.tax_percent) || 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const oid = resolveRowId(item);
    if (!oid) {
      throw new OrderCreationError(
        `additional_charges.update[${i}]: _id is required.`,
        400
      );
    }

    const row = await OrderAdditionalCharge.findOne({
      _id: oid,
      order_id: order._id,
      deleted_at: null,
    });
    if (!row) {
      throw new OrderCreationError(
        `additional_charges.update[${i}]: charge not found on this order.`,
        404
      );
    }

    if (item.label !== undefined) row.label = item.label;
    if (item.description !== undefined) row.description = item.description;
    if (item.amount !== undefined) {
      if (Number(item.amount) < 0) {
        throw new OrderCreationError(
          `additional_charges.update[${i}]: amount must be >= 0.`,
          400
        );
      }
      const chargeLine = computeAdditionalChargeLine(item.amount, taxPercent);
      row.amount = chargeLine.amount;
      row.tax_percent = chargeLine.tax_percent;
      row.tax_amount = chargeLine.tax_amount;
      row.total_amount = chargeLine.total_amount;
    }
    if (item.payment_method !== undefined) {
      row.payment_method = resolveChargePaymentMethod(item.payment_method);
    }
    if (item.charge_type !== undefined) row.charge_type = item.charge_type;
    row.updated_at = new Date();
    await row.save();
    updated.push(row);
  }
  return updated;
};

const applyPaymentUpdates = async (order, items) => {
  const updated = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const oid = resolveRowId(item);
    if (!oid) {
      throw new OrderCreationError(
        `order_payments.update[${i}]: _id is required.`,
        400
      );
    }

    const row = await OrderPayment.findOne({
      _id: oid,
      order_id: order._id,
      deleted_at: null,
    });
    if (!row) {
      throw new OrderCreationError(
        `order_payments.update[${i}]: payment not found on this order.`,
        404
      );
    }

    if (item.amount !== undefined) {
      if (Number(item.amount) < 0) {
        throw new OrderCreationError(
          `order_payments.update[${i}]: amount must be >= 0.`,
          400
        );
      }
      row.amount = Number(item.amount);
    }
    if (item.payment_method !== undefined) {
      row.payment_method = String(item.payment_method);
    }
    if (item.status !== undefined) {
      if (!PAYMENT_STATUSES.has(item.status)) {
        throw new OrderCreationError(
          `order_payments.update[${i}]: invalid status.`,
          400
        );
      }
      row.status = item.status;
    }
    if (item.transaction_reference !== undefined) {
      row.transaction_reference = item.transaction_reference;
    }
    if (item.installment_index !== undefined) {
      row.installment_index =
        item.installment_index === null ? null : Number(item.installment_index);
    }
    if (item.due_date !== undefined) {
      row.due_date = item.due_date ? new Date(item.due_date) : null;
    }
    if (item.paid_at !== undefined) {
      row.paid_at = item.paid_at ? new Date(item.paid_at) : null;
    }
    if (item.notes !== undefined) row.notes = item.notes;
    row.updated_at = new Date();
    await row.save();
    updated.push(row);
  }
  return updated;
};

/**
 * Create nested charges/payments after order document is saved (create flow).
 */
const applyNestedResourcesOnCreate = async (order, body) => {
  if (!hasNestedPayload(body)) {
    return null;
  }

  const chargeOps = normalizeNestedOps(body.additional_charges, "additional_charges");
  const paymentOps = normalizeNestedOps(body.order_payments, "order_payments");

  if (chargeOps.update.length || chargeOps.delete.length) {
    throw new OrderCreationError(
      "additional_charges on create only supports an array or { create: [...] }.",
      400
    );
  }
  if (paymentOps.update.length || paymentOps.delete.length) {
    throw new OrderCreationError(
      "order_payments on create only supports an array or { create: [...] }.",
      400
    );
  }

  const chargesCreated = await applyChargeCreates(order, chargeOps.create);
  const paymentsCreated = await applyPaymentCreates(order, paymentOps.create);

  return {
    additional_charges: {
      created: chargesCreated.map((d) => d._id),
    },
    order_payments: {
      created: paymentsCreated.map((d) => d._id),
    },
  };
};

/**
 * Apply nested charge/payment CRUD on order update.
 */
const applyNestedResourcesOnUpdate = async (order, body) => {
  if (!hasNestedPayload(body)) {
    return null;
  }

  const chargeOps = normalizeNestedOps(body.additional_charges, "additional_charges");
  const paymentOps = normalizeNestedOps(body.order_payments, "order_payments");

  let chargesTouched = false;
  let paymentsTouched = false;

  const chargesDeleted = await softDeleteCharges(order._id, chargeOps.delete);
  if (chargesDeleted.length) chargesTouched = true;

  const chargesUpdated = await applyChargeUpdates(order, chargeOps.update);
  if (chargesUpdated.length) chargesTouched = true;

  const chargesCreated = await applyChargeCreates(order, chargeOps.create);
  if (chargesCreated.length) chargesTouched = true;

  const paymentsDeleted = await softDeletePayments(order._id, paymentOps.delete);
  if (paymentsDeleted.length) paymentsTouched = true;

  const paymentsUpdated = await applyPaymentUpdates(order, paymentOps.update);
  if (paymentsUpdated.length) paymentsTouched = true;

  const paymentsCreated = await applyPaymentCreates(order, paymentOps.create);
  if (paymentsCreated.length) paymentsTouched = true;

  if (chargesTouched) {
    await recalculateOrderTotals(order._id);
  } else if (paymentsTouched) {
    await syncOrderPaymentStatus(order._id);
  }

  return {
    additional_charges: {
      created: chargesCreated.map((d) => d._id),
      updated: chargesUpdated.map((d) => d._id),
      deleted: chargesDeleted,
    },
    order_payments: {
      created: paymentsCreated.map((d) => d._id),
      updated: paymentsUpdated.map((d) => d._id),
      deleted: paymentsDeleted,
    },
  };
};

module.exports = {
  hasNestedPayload,
  applyNestedResourcesOnCreate,
  applyNestedResourcesOnUpdate,
};
