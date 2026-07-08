const OrderAdditionalCharge = require('../models/order_additional_charge');
const Order = require('../models/order');
const { computeAdditionalChargeLine } = require('../utils/order_pricing');
const { recalculateOrderTotals } = require('../utils/order_financials');
const {
  safeNotifyOrderAdditionalChargeAdded,
  safeNotifyOrderAdditionalChargeUpdated,
  safeNotifyOrderAdditionalChargeRemoved,
} = require('../src/modules/notifications/services/domainHooks');

const ALLOWED_CHARGE_METHODS = new Set([
  'cash',
  'upi',
  'card',
  'online',
  'bank_transfer',
  'other',
]);

const resolveChargePaymentMethod = (payment_method) => {
  if (
    payment_method &&
    ALLOWED_CHARGE_METHODS.has(String(payment_method).toLowerCase())
  ) {
    return String(payment_method).toLowerCase();
  }
  return 'other';
};

const buildChargeLineFromOrder = (order, amount) => {
  const taxPercent = Number(order.tax_percent) || 0;
  const commissionPercent = Number(order.commission_percent) || 0;
  return computeAdditionalChargeLine(amount, taxPercent, commissionPercent);
};

const listActiveChargesByOrder = async (orderId) =>
  OrderAdditionalCharge.find({
    order_id: orderId,
    deleted_at: null,
  })
    .sort({ created_at: -1 })
    .lean();

const normalizeChargeCreateInput = (item = {}) => ({
  label: item.label != null ? String(item.label) : '',
  description: item.description != null ? String(item.description) : '',
  amount: Number(item.amount),
  payment_method: resolveChargePaymentMethod(item.payment_method),
  charge_type: item.charge_type != null ? String(item.charge_type) : 'misc',
});

const normalizeChargeUpdateInput = (updates = {}) => {
  const normalized = {};
  if (updates.label !== undefined) normalized.label = updates.label;
  if (updates.description !== undefined) normalized.description = updates.description;
  if (updates.amount !== undefined) normalized.amount = Number(updates.amount);
  if (updates.payment_method !== undefined) {
    normalized.payment_method = resolveChargePaymentMethod(updates.payment_method);
  }
  if (updates.charge_type !== undefined) normalized.charge_type = updates.charge_type;
  return normalized;
};

const createAdditionalCharge = async (order, item) => {
  const payload = normalizeChargeCreateInput(item);
  const chargeLine = buildChargeLineFromOrder(order, payload.amount);

  const doc = new OrderAdditionalCharge({
    order_id: order._id,
    label: payload.label,
    description: payload.description,
    amount: chargeLine.amount,
    commission_percent: chargeLine.commission_percent,
    commission_amount: chargeLine.commission_amount,
    tax_percent: chargeLine.tax_percent,
    tax_amount: chargeLine.tax_amount,
    total_amount: chargeLine.total_amount,
    payment_method: payload.payment_method,
    charge_type: payload.charge_type,
  });
  await doc.save();
  await recalculateOrderTotals(order._id);
  const refreshedOrder = await Order.findById(order._id);
  void safeNotifyOrderAdditionalChargeAdded({
    order: refreshedOrder || order,
    charge: doc,
    actorUserId: item.actorUserId || null,
  });
  return doc;
};

const updateAdditionalCharge = async (order, row, updates, options = {}) => {
  const actorUserId = options.actorUserId || null;
  const payload = normalizeChargeUpdateInput(updates);
  if (payload.label !== undefined) row.label = payload.label;
  if (payload.description !== undefined) row.description = payload.description;
  if (payload.amount !== undefined) {
    const chargeLine = buildChargeLineFromOrder(order, payload.amount);
    row.amount = chargeLine.amount;
    row.commission_percent = chargeLine.commission_percent;
    row.commission_amount = chargeLine.commission_amount;
    row.tax_percent = chargeLine.tax_percent;
    row.tax_amount = chargeLine.tax_amount;
    row.total_amount = chargeLine.total_amount;
  }
  if (payload.payment_method !== undefined) row.payment_method = payload.payment_method;
  if (payload.charge_type !== undefined) row.charge_type = payload.charge_type;
  row.updated_at = new Date();
  await row.save();
  await recalculateOrderTotals(row.order_id);
  const refreshedOrder = await Order.findById(row.order_id);
  void safeNotifyOrderAdditionalChargeUpdated({
    order: refreshedOrder || order,
    charge: row,
    actorUserId,
  });
  return row;
};

const deleteAdditionalCharge = async (row, options = {}) => {
  const actorUserId = options.actorUserId || null;
  const chargeLabel = row.label || "";
  const chargeId = row._id;
  const orderId = row.order_id;
  row.deleted_at = new Date();
  row.updated_at = new Date();
  await row.save();
  await recalculateOrderTotals(orderId);
  const refreshedOrder = await Order.findById(orderId);
  if (refreshedOrder) {
    void safeNotifyOrderAdditionalChargeRemoved({
      order: refreshedOrder,
      chargeId,
      label: chargeLabel,
      actorUserId,
    });
  }
};

module.exports = {
  ALLOWED_CHARGE_METHODS,
  resolveChargePaymentMethod,
  normalizeChargeCreateInput,
  normalizeChargeUpdateInput,
  listActiveChargesByOrder,
  createAdditionalCharge,
  updateAdditionalCharge,
  deleteAdditionalCharge,
};
