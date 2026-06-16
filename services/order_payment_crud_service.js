const OrderPayment = require('../models/order_payment');
const { syncOrderPaymentStatus } = require('./order_payment_status_service');
const { syncAllPartnerOrderPaymentsForOrder } = require('./partner_wallet_order_service');
const { safeNotifyOrderPaymentReceived } = require('../src/modules/notifications/services/domainHooks');

const PAYER_TYPES = new Set(['customer', 'partner']);
const PAYMENT_STATUSES = new Set(['pending', 'completed', 'failed', 'refunded']);

const syncAfterOrderPaymentChange = async (orderId) => {
  const syncResult = await syncOrderPaymentStatus(orderId);
  await syncAllPartnerOrderPaymentsForOrder(orderId);
  return syncResult;
};

const normalizePaymentStatus = (status, fallback = 'pending') => {
  if (status && PAYMENT_STATUSES.has(status)) {
    return status;
  }
  return fallback;
};

const resolvePaidAt = (body, status, { autoPaidAtOnCompleted = false } = {}) => {
  if (body.paid_at !== undefined && body.paid_at !== null && body.paid_at !== '') {
    return new Date(body.paid_at);
  }
  if (autoPaidAtOnCompleted && status === 'completed') {
    return new Date();
  }
  return null;
};

const normalizeStringField = (value, trimStrings) => {
  if (value == null || value === '') {
    return '';
  }
  const str = String(value);
  return trimStrings ? str.trim() : str;
};

const buildCreatePaymentPayload = (
  body,
  {
    payerType,
    defaultStatus = 'pending',
    autoPaidAtOnCompleted = false,
    trimStrings = false,
  } = {}
) => {
  const payer_type = payerType ?? body.payer_type;
  const status = normalizePaymentStatus(body.status, defaultStatus);

  return {
    payer_type,
    amount: Number(body.amount),
    payment_method: normalizeStringField(body.payment_method, trimStrings),
    status,
    transaction_reference: normalizeStringField(body.transaction_reference, trimStrings),
    installment_index:
      body.installment_index !== undefined && body.installment_index !== null
        ? Number(body.installment_index)
        : null,
    due_date: body.due_date ? new Date(body.due_date) : null,
    paid_at: resolvePaidAt(body, status, { autoPaidAtOnCompleted }),
    notes: normalizeStringField(body.notes, trimStrings),
  };
};

const createOrderPaymentRecord = async (order, body, options = {}) => {
  const fields = buildCreatePaymentPayload(body, options);
  const doc = new OrderPayment({
    order_id: order._id,
    ...fields,
  });
  await doc.save();
  const syncResult = await syncAfterOrderPaymentChange(order._id);
  if (fields.status === 'completed') {
    void safeNotifyOrderPaymentReceived({
      order: syncResult?.order || order,
      payment: doc,
      actorUserId: options.actorUserId || null,
    });
  }
  return { doc, syncResult };
};

const applyOrderPaymentFieldUpdates = (
  row,
  body,
  { validateStatus = true, trimStrings = false } = {}
) => {
  if (body.amount !== undefined) {
    row.amount = Number(body.amount);
  }
  if (body.payment_method !== undefined) {
    row.payment_method = trimStrings
      ? String(body.payment_method).trim()
      : String(body.payment_method);
  }
  if (body.status !== undefined) {
    if (validateStatus && !PAYMENT_STATUSES.has(body.status)) {
      return { ok: false, status: 400, message: 'Invalid status.' };
    }
    row.status = body.status;
  }
  if (body.transaction_reference !== undefined) {
    row.transaction_reference = trimStrings
      ? String(body.transaction_reference).trim()
      : body.transaction_reference;
  }
  if (body.installment_index !== undefined) {
    row.installment_index =
      body.installment_index === null ? null : Number(body.installment_index);
  }
  if (body.due_date !== undefined) {
    row.due_date = body.due_date ? new Date(body.due_date) : null;
  }
  if (body.paid_at !== undefined) {
    row.paid_at = body.paid_at ? new Date(body.paid_at) : null;
  }
  if (body.notes !== undefined) {
    row.notes = trimStrings ? String(body.notes).trim() : body.notes;
  }

  return { ok: true };
};

const commitOrderPaymentUpdate = async (row, orderId) => {
  row.updated_at = new Date();
  await row.save();
  const syncResult = await syncAfterOrderPaymentChange(orderId);
  return { ok: true, row, syncResult };
};

const updateOrderPaymentRecord = async (row, order, body, options = {}) => {
  const previousStatus = row.status;
  const updateResult = applyOrderPaymentFieldUpdates(row, body, options);
  if (!updateResult.ok) {
    return updateResult;
  }

  const result = await commitOrderPaymentUpdate(row, order._id);
  if (
    row.status === 'completed' &&
    previousStatus !== 'completed'
  ) {
    void safeNotifyOrderPaymentReceived({
      order: result.syncResult?.order || order,
      payment: row,
      actorUserId: options.actorUserId || null,
    });
  }
  return result;
};

const softDeleteOrderPaymentRecord = async (row, orderId) => {
  row.deleted_at = new Date();
  row.updated_at = new Date();
  await row.save();
  const syncResult = await syncAfterOrderPaymentChange(orderId);
  return syncResult;
};

const formatAdminOrderPaymentSummary = (syncedOrder) => ({
  payment_status: syncedOrder.payment_status,
  is_paid: syncedOrder.is_paid,
  customer_due_amount: syncedOrder.customer_due_amount,
  total_price: syncedOrder.total_price,
});

const formatMobileCustomerOrderSummary = (syncedOrder, breakdown) => ({
  payment_status: syncedOrder.payment_status,
  user_payment_status: syncedOrder.user_payment_status,
  is_paid: syncedOrder.is_paid,
  customer_paid_amount: syncedOrder.customer_paid_amount,
  customer_due_amount: syncedOrder.customer_due_amount,
  customer_net_paid: syncedOrder.customer_net_paid,
  total_price: syncedOrder.total_price,
  order_payment_status: breakdown?.payment_status,
});

module.exports = {
  PAYER_TYPES,
  PAYMENT_STATUSES,
  syncAfterOrderPaymentChange,
  buildCreatePaymentPayload,
  createOrderPaymentRecord,
  applyOrderPaymentFieldUpdates,
  commitOrderPaymentUpdate,
  updateOrderPaymentRecord,
  softDeleteOrderPaymentRecord,
  formatAdminOrderPaymentSummary,
  formatMobileCustomerOrderSummary,
};
