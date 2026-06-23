const mongoose = require('mongoose');
const Order = require('../models/order');
const OrderPayment = require('../models/order_payment');
const GatewayPayment = require('../models/gateway_payment');
const {
  createOrderPaymentRecord,
  formatAdminOrderPaymentSummary,
  PAYMENT_STATUSES,
} = require('./order_payment_crud_service');
const { validatePartnerOrderPayment } = require('./partner_order_payment_validation');
const {
  loadCustomerProfile,
  initiateOnlineOrderPayment,
  syncPendingOrderPayment,
  finalizeCompletedOrderPaymentSideEffects,
  RAZORPAY_LINK_RESUMABLE,
} = require('../src/modules/payments/services/orderOnlinePayment.service');
const { fetchPaymentLink } = require('../src/modules/payments/razorpay.client');
const {
  PAYMENT_PURPOSES,
  GATEWAY_PAYMENT_METHOD,
} = require('../src/modules/payments/constants/payment.constants');

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const normalizePaymentMethod = (raw) =>
  raw !== undefined && raw !== null ? String(raw).trim().toLowerCase() : '';

const resolveCustomerForOnlinePayment = async (order, body = {}) => {
  if (!order?.user_id) {
    return fail(400, 'Order has no customer; cannot create Razorpay payment link.');
  }

  const profile = await loadCustomerProfile(order.user_id);
  if (!profile.ok) {
    return profile;
  }

  const name =
    body.name !== undefined && String(body.name).trim() !== ''
      ? String(body.name).trim()
      : profile.user.name;
  const email =
    body.email !== undefined && String(body.email).trim() !== ''
      ? String(body.email).trim()
      : profile.user.email;
  const phone_number =
    body.contact !== undefined && String(body.contact).trim() !== ''
      ? String(body.contact).trim()
      : body.phone_number !== undefined && String(body.phone_number).trim() !== ''
        ? String(body.phone_number).trim()
        : profile.user.phone_number;

  if (!email && !phone_number) {
    return fail(
      400,
      'Customer must have email or phone on profile (or pass name, email, contact on the request body).'
    );
  }

  return {
    ok: true,
    customer: {
      name: name || 'Customer',
      email: email || null,
      phone_number: phone_number || null,
    },
  };
};

const createAdminOrderPayment = async (order, body) => {
  const payer_type = body.payer_type;
  const amount = Number(body.amount);
  const paymentMethod = normalizePaymentMethod(body.payment_method);
  const st =
    body.status && PAYMENT_STATUSES.has(body.status) ? body.status : 'pending';

  if (payer_type === 'partner') {
    const partnerCheck = await validatePartnerOrderPayment(order, {
      amount,
      status: st,
    });
    if (!partnerCheck.ok) {
      return fail(partnerCheck.status, partnerCheck.message);
    }
  }

  if (paymentMethod === GATEWAY_PAYMENT_METHOD && payer_type === 'customer' && amount > 0) {
    if (st === 'completed') {
      return fail(
        400,
        'Online payments cannot be marked completed until Razorpay confirms payment.'
      );
    }

    const customerResult = await resolveCustomerForOnlinePayment(order, body);
    if (!customerResult.ok) {
      return customerResult;
    }

    const onlineResult = await initiateOnlineOrderPayment({
      order,
      customer: customerResult.customer,
      amount,
      notes: body.notes || '',
      installment_index: body.installment_index,
      due_date: body.due_date,
    });

    if (!onlineResult.ok) {
      return fail(onlineResult.status, onlineResult.message);
    }

    let paymentRow = onlineResult.payment;
    let breakdown = null;
    if (onlineResult.already_completed) {
      const sync = await finalizeCompletedOrderPaymentSideEffects(order._id, {
        payment: paymentRow,
        notify: true,
      });
      breakdown = sync?.breakdown;
      paymentRow = await OrderPayment.findById(paymentRow._id).lean();
    }

    const latestOrder =
      onlineResult.already_completed
        ? await Order.findById(order._id).lean()
        : order;

    return ok(onlineResult.status, {
      message: onlineResult.resumed
        ? 'Continue the pending payment to complete this order payment.'
        : onlineResult.already_completed
          ? 'Order payment completed successfully.'
          : 'Complete payment to record this order payment.',
      record: {
        ...paymentRow,
        payment_url: onlineResult.payment_url || null,
        resumed: Boolean(onlineResult.resumed),
      },
      order_payment_status: breakdown?.payment_status ?? latestOrder.payment_status,
      order: formatAdminOrderPaymentSummary(latestOrder),
    });
  }

  const { doc, syncResult } = await createOrderPaymentRecord(order, body, {
    payerType: payer_type,
    defaultStatus: st,
    autoPaidAtOnCompleted: false,
    trimStrings: false,
  });
  const syncedOrder = syncResult?.order;
  const breakdown = syncResult?.breakdown;

  return ok(201, {
    message: 'Order payment record created.',
    record: doc,
    order_payment_status: breakdown.payment_status,
    order: formatAdminOrderPaymentSummary(syncedOrder),
  });
};

const loadAdminOrderPayment = async (paymentId) => {
  if (!paymentId || !mongoose.Types.ObjectId.isValid(String(paymentId))) {
    return fail(400, 'Invalid payment id.');
  }

  const payment = await OrderPayment.findOne({
    _id: paymentId,
    deleted_at: null,
  });

  if (!payment) {
    return fail(404, 'Payment not found.');
  }

  const order = await Order.findOne({ _id: payment.order_id, deleted_at: null });
  if (!order) {
    return fail(404, 'Order not found.');
  }

  return ok(200, { payment, order });
};

const getAdminOrderPaymentStatus = async (paymentId) => {
  try {
    const loaded = await loadAdminOrderPayment(paymentId);
    if (!loaded.ok) return loaded;

    const payment = loaded.data.payment;
    const order = loaded.data.order;

    let syncResult = null;
    if (
      payment.status === 'pending' &&
      payment.payment_method === GATEWAY_PAYMENT_METHOD &&
      payment.transaction_reference
    ) {
      syncResult = await syncPendingOrderPayment(payment._id);
    }

    let latestPayment = payment.toObject ? payment.toObject() : payment;
    if (syncResult?.synced) {
      latestPayment = await OrderPayment.findById(payment._id).lean();
    }

    let paymentUrl = null;
    if (latestPayment.status === 'pending' && latestPayment.transaction_reference) {
      try {
        const link = await fetchPaymentLink(latestPayment.transaction_reference);
        if (RAZORPAY_LINK_RESUMABLE.has(link.status) && link.short_url) {
          paymentUrl = link.short_url;
        }
      } catch (err) {
        console.error('getAdminOrderPaymentStatus fetchPaymentLink', err?.response?.data || err.message);
      }
    }

    let gatewayPayment = null;
    if (latestPayment.status === 'completed') {
      gatewayPayment = await GatewayPayment.findOne({
        purpose: PAYMENT_PURPOSES.ORDER,
        reference_id: latestPayment._id,
        deleted_at: null,
      })
        .select(
          'amount currency status payment_method gateway_payment_link_id gateway_payment_id instrument_type paid_at created_at'
        )
        .lean();
    }

    let breakdown = null;
    let latestOrder = order;
    if (syncResult?.synced) {
      latestPayment = await OrderPayment.findById(payment._id).lean();
      latestOrder = syncResult.syncResult?.order || (await Order.findById(order._id).lean());
      breakdown = syncResult.syncResult?.breakdown;
    }

    return ok(200, {
      message: syncResult?.synced
        ? 'Payment verified with Razorpay and order payment applied.'
        : 'Order payment status fetched successfully.',
      data: {
        payment_id: latestPayment._id,
        order_id: latestPayment.order_id,
        status: latestPayment.status,
        amount: latestPayment.amount,
        payment_method: latestPayment.payment_method,
        transaction_reference: latestPayment.transaction_reference,
        payment_url: paymentUrl,
        paid_at: latestPayment.paid_at,
        gateway_payment: gatewayPayment,
        order: formatAdminOrderPaymentSummary(latestOrder),
        order_payment_status: breakdown?.payment_status ?? latestOrder.payment_status,
        ...(syncResult
          ? {
              sync: {
                attempted: payment.status === 'pending',
                synced: syncResult.synced,
                reason: syncResult.reason || null,
                razorpay_status: syncResult.razorpay_status || null,
              },
            }
          : {}),
      },
    });
  } catch (err) {
    console.error('admin get order payment status', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  createAdminOrderPayment,
  getAdminOrderPaymentStatus,
};
