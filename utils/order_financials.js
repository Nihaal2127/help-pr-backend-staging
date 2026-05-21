const Order = require("../models/order");
const OrderAdditionalCharge = require("../models/order_additional_charge");
const { syncOrderPaymentStatus } = require("../services/order_payment_status_service");
const { syncAllPartnerOrderPaymentsForOrder } = require("../services/partner_wallet_order_service");
const {
  computeOrderTotal,
  aggregateAdditionalCharges,
  finalizeOrderPricing,
  computeAdditionalChargeLine,
} = require("./order_pricing");

/**
 * Recomputes additional charge rollups and order.total_price / minimum_deposit_amount.
 */
const recalculateOrderTotals = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order || order.deleted_at) return null;

  const rows = await OrderAdditionalCharge.find({
    order_id: order._id,
    $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
  }).lean();

  const taxPercent =
    order.tax_percent !== undefined && order.tax_percent !== null
      ? Number(order.tax_percent)
      : 0;
  const commissionPercent =
    order.commission_percent !== undefined && order.commission_percent !== null
      ? Number(order.commission_percent)
      : 0;

  for (const row of rows) {
    const line = computeAdditionalChargeLine(
      row.amount,
      taxPercent,
      commissionPercent
    );
    await OrderAdditionalCharge.updateOne(
      { _id: row._id },
      {
        $set: {
          commission_percent: line.commission_percent,
          commission_amount: line.commission_amount,
          tax_percent: line.tax_percent,
          tax_amount: line.tax_amount,
          total_amount: line.total_amount,
          updated_at: new Date(),
        },
      }
    );
    row.commission_percent = line.commission_percent;
    row.commission_amount = line.commission_amount;
    row.tax_amount = line.tax_amount;
    row.total_amount = line.total_amount;
  }

  const additionalAgg = aggregateAdditionalCharges(rows);

  const finalized = finalizeOrderPricing(
    {
      sub_total: order.sub_total,
      tax_amount: order.tax_amount ?? order.tax,
      tax_percent: order.tax_percent,
      minimum_deposit_percent: order.minimum_deposit_percent,
      discount_amount: order.discount_amount,
    },
    additionalAgg,
    order.discount_amount
  );

  order.additional_charges_subtotal = finalized.additional_charges_subtotal;
  order.additional_charges_commission = finalized.additional_charges_commission;
  order.additional_charges_tax = finalized.additional_charges_tax;
  order.additional_charges_total = finalized.additional_charges_total;
  order.tax_amount = finalized.tax_amount;
  order.tax = finalized.tax_amount;
  order.total_price = finalized.total_price;
  order.minimum_deposit_amount = finalized.minimum_deposit_amount;
  order.min_deposit = finalized.minimum_deposit_amount;
  order.updated_at = new Date();
  await order.save();
  await syncOrderPaymentStatus(orderId);
  await syncAllPartnerOrderPaymentsForOrder(orderId);
  return Order.findById(orderId);
};

module.exports = { recalculateOrderTotals, computeOrderTotal };
