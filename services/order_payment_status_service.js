const Order = require("../models/order");
const OrderService = require("../models/order_services");
const OrderPayment = require("../models/order_payment");
const {
  ORDER_PAYMENT_STATUS_PAID,
  computeCustomerPaymentStatus,
  computePartnerPaymentStatus,
} = require("../enum/order_payment_status_enum");
const { computeOrderPartnerCreditAmount } = require("./partner_wallet_order_service");
const {
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_REFUNDED,
  clearPendingAmountsForTerminalOrder,
  isOrderStatusWithNoPendingAmounts,
} = require("../enum/order_status_enum");

/**
 * Recompute and persist customer + partner payment rollups on the order.
 * Call after customer/partner order_payment changes or order total changes.
 */
const syncOrderPaymentStatus = async (orderId) => {
  const order = await Order.findOne({ _id: orderId, deleted_at: null });
  if (!order) return null;

  const payments = await OrderPayment.find({
    order_id: order._id,
    deleted_at: null,
  }).lean();

  const customerBreakdown = computeCustomerPaymentStatus(
    Number(order.total_price) || 0,
    payments
  );
  let partnerEntitlement = 0;
  if (order.partner_id) {
    const credit = await computeOrderPartnerCreditAmount(order);
    partnerEntitlement = credit?.amount ?? 0;
  }
  const partnerBreakdown = computePartnerPaymentStatus(
    customerBreakdown.customer_net_paid,
    payments,
    partnerEntitlement
  );

  order.payment_status = customerBreakdown.payment_status;
  order.user_payment_status =
    customerBreakdown.user_payment_status ?? customerBreakdown.payment_status;
  order.customer_paid_amount = customerBreakdown.customer_paid_amount;
  order.customer_refunded_amount = customerBreakdown.customer_refunded_amount;
  order.customer_net_paid = customerBreakdown.customer_net_paid;
  order.customer_due_amount = customerBreakdown.customer_due_amount;
  order.is_paid = customerBreakdown.payment_status === ORDER_PAYMENT_STATUS_PAID;

  order.partner_payment_status = partnerBreakdown.partner_payment_status;
  order.partner_paid_amount = partnerBreakdown.partner_paid_amount;
  order.partner_due_amount = partnerBreakdown.partner_due_amount;

  clearPendingAmountsForTerminalOrder(order);

  if (isOrderStatusWithNoPendingAmounts(order.order_status)) {
    customerBreakdown.customer_due_amount = 0;
    partnerBreakdown.partner_due_amount = 0;
  }

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

  return {
    order,
    breakdown: customerBreakdown,
    partnerBreakdown,
  };
};

module.exports = {
  syncOrderPaymentStatus,
};
