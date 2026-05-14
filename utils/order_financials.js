const Order = require("../models/order");
const OrderAdditionalCharge = require("../models/order_additional_charge");

/**
 * Customer-facing total before persistence (e.g. Razorpay link before first save).
 * admin_commission does not reduce this total (reporting field).
 */
const computeOrderTotal = (orderLike, additionalChargesSum = 0) => {
  const sub = Number(orderLike.sub_total) || 0;
  const tax = Number(orderLike.tax) || 0;
  const userFee = Number(orderLike.user_paltform_fee) || 0;
  const partnerFee = Number(orderLike.partner_commison_platform_fee) || 0;
  const add = Number(additionalChargesSum) || 0;
  const disc =
    orderLike.discount_amount !== null && orderLike.discount_amount !== undefined
      ? Number(orderLike.discount_amount)
      : 0;
  let total = sub + tax + userFee + partnerFee + add - disc;
  if (total < 0) total = 0;
  return total;
};

/**
 * Recomputes additional_charges_total from line items and sets order.total_price as:
 * sub_total + tax + user_paltform_fee + partner_commison_platform_fee + additional_charges_total - discount_amount
 * (admin_commission is stored for reporting; it does not change customer total here.)
 */
const recalculateOrderTotals = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order || order.deleted_at) return null;

  const agg = await OrderAdditionalCharge.aggregate([
    {
      $match: {
        order_id: order._id,
        $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
      },
    },
    { $group: { _id: null, sum: { $sum: "$amount" } } },
  ]);
  const additionalSum = agg.length ? agg[0].sum : 0;
  order.additional_charges_total = additionalSum;
  order.total_price = computeOrderTotal(order, additionalSum);

  order.updated_at = new Date();
  await order.save();
  return order;
};

module.exports = { recalculateOrderTotals, computeOrderTotal };
