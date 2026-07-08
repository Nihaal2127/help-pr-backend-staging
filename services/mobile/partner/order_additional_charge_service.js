const Order = require('../../../models/order');
const OrderAdditionalCharge = require('../../../models/order_additional_charge');
const { loadPartnerOrder } = require('../shared/order_access_helpers');
const {
  listActiveChargesByOrder,
  createAdditionalCharge,
  updateAdditionalCharge,
  deleteAdditionalCharge,
} = require('../../order_additional_charge_service');
const {
  buildPartnerOrderSummaryFromOrderDoc,
  formatPartnerAdditionalCharge,
} = require('../../../utils/partner_order_summary');

const { fail, ok } = require('../../../utils/mobile_service_result');

const formatOrderPricingSummary = async (order) => ({
  payment_status: order.payment_status,
  user_payment_status: order.user_payment_status,
  is_paid: order.is_paid,
  customer_paid_amount: order.customer_paid_amount,
  customer_due_amount: order.customer_due_amount,
  customer_net_paid: order.customer_net_paid,
  total_price: order.total_price,
  additional_charges_subtotal: order.additional_charges_subtotal,
  additional_charges_commission: order.additional_charges_commission,
  additional_charges_tax: order.additional_charges_tax,
  additional_charges_total: order.additional_charges_total,
  partner_summary: await buildPartnerOrderSummaryFromOrderDoc(order),
});

const reloadOrderForPricing = async (orderId) => {
  const order = await Order.findOne({ _id: orderId, deleted_at: null });
  return order || null;
};

const reloadOrderSummary = async (orderId) => {
  const order = await reloadOrderForPricing(orderId);
  return order ? await formatOrderPricingSummary(order) : null;
};

const listPartnerOrderAdditionalCharges = async (partnerId, orderId) => {
  try {
    const access = await loadPartnerOrder(partnerId, orderId);
    if (!access.ok) return access;

    const order = await reloadOrderForPricing(access.data.order._id);
    if (!order) {
      return fail(404, 'Order not found.');
    }

    const rows = await listActiveChargesByOrder(order._id);
    const partnerSummary = await buildPartnerOrderSummaryFromOrderDoc(order);

    return ok(200, {
      message: 'Additional charges fetched.',
      records: rows.map(formatPartnerAdditionalCharge),
      partner_summary: partnerSummary,
    });
  } catch (err) {
    console.error('mobile partner list order additional charges', err.message);
    return fail(500, 'Internal server error.');
  }
};

const createPartnerOrderAdditionalCharge = async (partnerId, orderId, body) => {
  try {
    const access = await loadPartnerOrder(partnerId, orderId);
    if (!access.ok) return access;

    const order = await reloadOrderForPricing(access.data.order._id);
    if (!order) {
      return fail(404, 'Order not found.');
    }

    const doc = await createAdditionalCharge(order, {
      ...body,
      actorUserId: partnerId,
    });
    const orderSummary = await reloadOrderSummary(order._id);

    return ok(201, {
      message: 'Additional charge added and order total updated.',
      record: formatPartnerAdditionalCharge(doc),
      order: orderSummary,
      partner_summary: orderSummary?.partner_summary ?? null,
    });
  } catch (err) {
    console.error('mobile partner create order additional charge', err.message);
    return fail(500, 'Internal server error.');
  }
};

const loadPartnerChargeOnOrder = async (partnerId, orderId, chargeId) => {
  const access = await loadPartnerOrder(partnerId, orderId);
  if (!access.ok) return access;

  if (!chargeId || !mongoose.Types.ObjectId.isValid(String(chargeId))) {
    return fail(400, 'Invalid charge id.');
  }

  const row = await OrderAdditionalCharge.findOne({
    _id: chargeId,
    order_id: access.data.order._id,
    deleted_at: null,
  });

  if (!row) {
    return fail(404, 'Charge not found.');
  }

  const order = await reloadOrderForPricing(access.data.order._id);
  if (!order) {
    return fail(404, 'Order not found.');
  }

  return ok(200, { order, charge: row });
};

const updatePartnerOrderAdditionalCharge = async (partnerId, orderId, chargeId, body) => {
  try {
    const loaded = await loadPartnerChargeOnOrder(partnerId, orderId, chargeId);
    if (!loaded.ok) return loaded;

    const row = await updateAdditionalCharge(loaded.data.order, loaded.data.charge, body, {
      actorUserId: partnerId,
    });
    const orderSummary = await reloadOrderSummary(loaded.data.order._id);

    return ok(200, {
      message: 'Charge updated and order total refreshed.',
      record: formatPartnerAdditionalCharge(row),
      order: orderSummary,
      partner_summary: orderSummary?.partner_summary ?? null,
    });
  } catch (err) {
    console.error('mobile partner update order additional charge', err.message);
    return fail(500, 'Internal server error.');
  }
};

const deletePartnerOrderAdditionalCharge = async (partnerId, orderId, chargeId) => {
  try {
    const loaded = await loadPartnerChargeOnOrder(partnerId, orderId, chargeId);
    if (!loaded.ok) return loaded;

    await deleteAdditionalCharge(loaded.data.charge, { actorUserId: partnerId });
    const orderSummary = await reloadOrderSummary(loaded.data.order._id);

    return ok(200, {
      message: 'Charge removed and order total refreshed.',
      order: orderSummary,
      partner_summary: orderSummary?.partner_summary ?? null,
    });
  } catch (err) {
    console.error('mobile partner delete order additional charge', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listPartnerOrderAdditionalCharges,
  createPartnerOrderAdditionalCharge,
  updatePartnerOrderAdditionalCharge,
  deletePartnerOrderAdditionalCharge,
};
