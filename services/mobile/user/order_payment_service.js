const mongoose = require('mongoose');
const Order = require('../../../models/order');
const OrderPayment = require('../../../models/order_payment');
const { syncOrderPaymentStatus } = require('../../order_payment_status_service');
const { syncAllPartnerOrderPaymentsForOrder } = require('../../partner_wallet_order_service');

const PAYER_TYPE_CUSTOMER = 'customer';
const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const loadCustomerOrder = async (customerId, orderId) => {
  if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) {
    return fail(401, 'Invalid token.');
  }
  if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
    return fail(400, 'Invalid order id.');
  }

  const order = await Order.findOne({
    _id: orderId,
    user_id: new mongoose.Types.ObjectId(String(customerId)),
    deleted_at: null,
  });

  if (!order) {
    return fail(404, 'Order not found.');
  }

  return ok(200, { order });
};

const formatSyncedOrderSummary = (syncedOrder, breakdown) => ({
  payment_status: syncedOrder.payment_status,
  user_payment_status: syncedOrder.user_payment_status,
  is_paid: syncedOrder.is_paid,
  customer_paid_amount: syncedOrder.customer_paid_amount,
  customer_due_amount: syncedOrder.customer_due_amount,
  customer_net_paid: syncedOrder.customer_net_paid,
  total_price: syncedOrder.total_price,
  order_payment_status: breakdown?.payment_status,
});

const syncAfterPaymentChange = async (orderId) => {
  const syncResult = await syncOrderPaymentStatus(orderId);
  await syncAllPartnerOrderPaymentsForOrder(orderId);
  return syncResult;
};

const listCustomerOrderPayments = async (customerId, orderId) => {
  try {
    const access = await loadCustomerOrder(customerId, orderId);
    if (!access.ok) return access;

    const rows = await OrderPayment.find({
      order_id: access.data.order._id,
      payer_type: PAYER_TYPE_CUSTOMER,
      deleted_at: null,
    })
      .sort({ created_at: -1 })
      .lean();

    return ok(200, {
      message: 'Order payments fetched.',
      records: rows,
    });
  } catch (err) {
    console.error('mobile user list order payments', err.message);
    return fail(500, 'Internal server error.');
  }
};

const createCustomerOrderPayment = async (customerId, orderId, body) => {
  try {
    const access = await loadCustomerOrder(customerId, orderId);
    if (!access.ok) return access;

    const order = access.data.order;
    const status = body.status || 'pending';
    const paidAt =
      body.paid_at !== undefined && body.paid_at !== null && body.paid_at !== ''
        ? new Date(body.paid_at)
        : status === 'completed'
          ? new Date()
          : null;

    const doc = new OrderPayment({
      order_id: order._id,
      payer_type: PAYER_TYPE_CUSTOMER,
      amount: Number(body.amount),
      payment_method: String(body.payment_method || '').trim(),
      status,
      transaction_reference: body.transaction_reference
        ? String(body.transaction_reference).trim()
        : '',
      installment_index:
        body.installment_index !== undefined && body.installment_index !== null
          ? Number(body.installment_index)
          : null,
      due_date: body.due_date ? new Date(body.due_date) : null,
      paid_at: paidAt,
      notes: body.notes ? String(body.notes).trim() : '',
    });
    await doc.save();

    const syncResult = await syncAfterPaymentChange(order._id);
    const syncedOrder = syncResult?.order;
    const breakdown = syncResult?.breakdown;

    return ok(201, {
      message: 'Order payment record created.',
      record: doc.toObject(),
      order: syncedOrder
        ? formatSyncedOrderSummary(syncedOrder, breakdown)
        : null,
    });
  } catch (err) {
    console.error('mobile user create order payment', err.message);
    return fail(500, 'Internal server error.');
  }
};

const loadCustomerPaymentOnOrder = async (customerId, orderId, paymentId) => {
  const access = await loadCustomerOrder(customerId, orderId);
  if (!access.ok) return access;

  if (!paymentId || !mongoose.Types.ObjectId.isValid(String(paymentId))) {
    return fail(400, 'Invalid payment id.');
  }

  const row = await OrderPayment.findOne({
    _id: paymentId,
    order_id: access.data.order._id,
    payer_type: PAYER_TYPE_CUSTOMER,
    deleted_at: null,
  });

  if (!row) {
    return fail(404, 'Payment not found.');
  }

  return ok(200, { order: access.data.order, payment: row });
};

const updateCustomerOrderPayment = async (customerId, orderId, paymentId, body) => {
  try {
    const loaded = await loadCustomerPaymentOnOrder(customerId, orderId, paymentId);
    if (!loaded.ok) return loaded;

    const row = loaded.data.payment;
    const order = loaded.data.order;

    if (body.amount !== undefined) {
      row.amount = Number(body.amount);
    }
    if (body.payment_method !== undefined) {
      row.payment_method = String(body.payment_method).trim();
    }
    if (body.status !== undefined) {
      row.status = body.status;
    }
    if (body.transaction_reference !== undefined) {
      row.transaction_reference = String(body.transaction_reference).trim();
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
      row.notes = String(body.notes).trim();
    }

    row.updated_at = new Date();
    await row.save();

    const syncResult = await syncAfterPaymentChange(order._id);
    const syncedOrder = syncResult?.order;
    const breakdown = syncResult?.breakdown;

    return ok(200, {
      message: 'Order payment updated.',
      record: row.toObject(),
      order: syncedOrder
        ? formatSyncedOrderSummary(syncedOrder, breakdown)
        : null,
    });
  } catch (err) {
    console.error('mobile user update order payment', err.message);
    return fail(500, 'Internal server error.');
  }
};

const deleteCustomerOrderPayment = async (customerId, orderId, paymentId) => {
  try {
    const loaded = await loadCustomerPaymentOnOrder(customerId, orderId, paymentId);
    if (!loaded.ok) return loaded;

    const row = loaded.data.payment;
    const order = loaded.data.order;

    row.deleted_at = new Date();
    row.updated_at = new Date();
    await row.save();

    const syncResult = await syncAfterPaymentChange(order._id);
    const breakdown = syncResult?.breakdown;

    return ok(200, {
      message: 'Order payment deleted.',
      order_payment_status: breakdown?.payment_status,
    });
  } catch (err) {
    console.error('mobile user delete order payment', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listCustomerOrderPayments,
  createCustomerOrderPayment,
  updateCustomerOrderPayment,
  deleteCustomerOrderPayment,
};
