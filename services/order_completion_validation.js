const OrderPayment = require("../models/order_payment");
const { OrderCreationError } = require("../errors/order_creation_error");
const {
  computeCustomerPaymentStatus,
  ORDER_PAYMENT_STATUS_PAID,
} = require("../enum/order_payment_status_enum");

/**
 * Customer payment breakdown for completion checks (live order_payment rows).
 */
const getCustomerPaymentBreakdownForOrder = async (order) => {
  const payments = await OrderPayment.find({
    order_id: order._id,
    payer_type: "customer",
    deleted_at: null,
  }).lean();

  return computeCustomerPaymentStatus(Number(order.total_price) || 0, payments);
};

const isCustomerPaidInFull = (breakdown) => {
  const status =
    breakdown?.user_payment_status ?? breakdown?.payment_status;
  return status === ORDER_PAYMENT_STATUS_PAID;
};

/**
 * Order / line may only move to `completed` when customer net paid >= order.total_price.
 */
const assertOrderCanBeMarkedCompleted = async (order) => {
  if (!order) {
    return { ok: false, status: 404, message: "Order not found." };
  }

  const breakdown = await getCustomerPaymentBreakdownForOrder(order);
  if (isCustomerPaidInFull(breakdown)) {
    return { ok: true, breakdown };
  }

  const totalDue = Number(order.total_price) || 0;
  const netPaid = breakdown.customer_net_paid;
  const due = breakdown.customer_due_amount;

  return {
    ok: false,
    status: 409,
    message: `Cannot mark order as completed until the customer has paid the full order amount (paid ${netPaid}, due ${due}, total ${totalDue}).`,
    breakdown,
  };
};

const assertOrderCanBeMarkedCompletedOrThrow = async (order) => {
  const result = await assertOrderCanBeMarkedCompleted(order);
  if (!result.ok) {
    throw new OrderCreationError(result.message, result.status);
  }
  return result;
};

module.exports = {
  getCustomerPaymentBreakdownForOrder,
  isCustomerPaidInFull,
  assertOrderCanBeMarkedCompleted,
  assertOrderCanBeMarkedCompletedOrThrow,
};
