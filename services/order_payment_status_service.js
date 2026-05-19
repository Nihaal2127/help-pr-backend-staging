const Order = require("../models/order");
const OrderService = require("../models/order_services");
const OrderPayment = require("../models/order_payment");
const {
  ORDER_PAYMENT_STATUS_PAID,
  computeCustomerPaymentStatus,
} = require("../enum/order_payment_status_enum");
const {
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_REFUNDED,
} = require("../enum/order_status_enum");

/**
 * Recompute and persist order.payment_status from customer order_payment rows.
 */
const syncOrderPaymentStatus = async (orderId) => {
  const order = await Order.findOne({ _id: orderId, deleted_at: null });
  if (!order) return null;

  const payments = await OrderPayment.find({
    order_id: order._id,
    payer_type: "customer",
    deleted_at: null,
  }).lean();

  const breakdown = computeCustomerPaymentStatus(
    Number(order.total_price) || 0,
    payments
  );

  order.payment_status = breakdown.payment_status;
  order.customer_paid_amount = breakdown.customer_paid_amount;
  order.customer_refunded_amount = breakdown.customer_refunded_amount;
  order.customer_net_paid = breakdown.customer_net_paid;
  order.customer_due_amount = breakdown.customer_due_amount;
  order.is_paid = breakdown.payment_status === ORDER_PAYMENT_STATUS_PAID;
  order.updated_at = new Date();
  await order.save();

  const linePaid = order.is_paid;
  if (order.service_items?.length) {
    await OrderService.updateMany(
      {
        _id: { $in: order.service_items },
        service_status: { $nin: [ORDER_STATUS_CANCELLED, ORDER_STATUS_REFUNDED] },
      },
      { $set: { is_paid: linePaid, updated_at: new Date() } }
    );
  }

  return { order, breakdown };
};

module.exports = { syncOrderPaymentStatus };
