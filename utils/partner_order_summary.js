const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

const resolveServiceEarning = (record) =>
  roundMoney(
    record?.service_items?.[0]?.partner_earning ??
      record?.service_items?.[0]?.total_service_charge ??
      record?.service_items?.[0]?.service_price ??
      0
  );

/**
 * Partner-facing earnings rollup for mobile order detail.
 * Partner pay = base service + base additional charges (no tax / platform commission).
 */
const buildPartnerOrderSummary = (record) => {
  if (!record || typeof record !== 'object') return null;

  const serviceEarning = resolveServiceEarning(record);
  const additionalChargesEarning = roundMoney(record.additional_charges_subtotal ?? 0);
  const totalEarning = roundMoney(serviceEarning + additionalChargesEarning);

  return {
    service_earning: serviceEarning,
    additional_charges_earning: additionalChargesEarning,
    total_earning: totalEarning,
    paid_amount: roundMoney(record.partner_paid_amount),
    due_amount: roundMoney(record.partner_due_amount),
    payment_status: record.partner_payment_status || 'unpaid',
    customer_order_total: roundMoney(record.total_price),
    customer_due_amount: roundMoney(record.customer_due_amount),
    customer_payment_status:
      record.user_payment_status || record.payment_status || 'unpaid',
  };
};

const buildPartnerSummaryPayload = ({
  serviceEarning,
  additionalChargesEarning,
  order,
}) => {
  const paidAmount = roundMoney(order.partner_paid_amount);
  const dueAmount = roundMoney(order.partner_due_amount);
  const totalEarning = roundMoney(serviceEarning + additionalChargesEarning);

  return {
    service_earning: serviceEarning,
    additional_charges_earning: additionalChargesEarning,
    total_earning: totalEarning,
    paid_amount: paidAmount,
    due_amount: dueAmount,
    payment_status: order.partner_payment_status || 'unpaid',
    customer_order_total: roundMoney(order.total_price),
    customer_due_amount: roundMoney(order.customer_due_amount),
    customer_payment_status:
      order.user_payment_status || order.payment_status || 'unpaid',
  };
};

const resolveServiceEarningFromOrderDoc = async (order) => {
  const serviceId = order?.service_items?.[0];
  if (!serviceId) return 0;

  const OrderService = require('../models/order_services');
  const line = await OrderService.findOne({
    _id: serviceId,
    deleted_at: null,
  })
    .select('partner_earning total_service_charge service_price')
    .lean();

  return roundMoney(
    line?.partner_earning ?? line?.total_service_charge ?? line?.service_price ?? 0
  );
};

/** Order document after pricing sync (additional-charge routes). */
const buildPartnerOrderSummaryFromOrderDoc = async (order) => {
  if (!order || typeof order !== 'object') return null;

  const serviceEarning = await resolveServiceEarningFromOrderDoc(order);
  const additionalChargesEarning = roundMoney(order.additional_charges_subtotal ?? 0);

  return buildPartnerSummaryPayload({
    serviceEarning,
    additionalChargesEarning,
    order,
  });
};

/** Sync fallback when service line is unavailable. */
const buildPartnerOrderSummaryFromRollup = (order) => {
  if (!order || typeof order !== 'object') return null;

  const additionalChargesEarning = roundMoney(order.additional_charges_subtotal);
  const paidAmount = roundMoney(order.partner_paid_amount);
  const dueAmount = roundMoney(order.partner_due_amount);
  const totalEarning = roundMoney(paidAmount + dueAmount);
  const serviceEarning = roundMoney(Math.max(0, totalEarning - additionalChargesEarning));

  return buildPartnerSummaryPayload({
    serviceEarning,
    additionalChargesEarning,
    order,
  });
};

/** Partner-facing row for additional charge list/detail. */
const formatPartnerAdditionalCharge = (row) => {
  if (!row || typeof row !== 'object') return row;
  const plain = typeof row.toObject === 'function' ? row.toObject() : { ...row };
  return {
    ...plain,
    partner_amount: roundMoney(plain.amount),
    customer_billed_total: roundMoney(plain.total_amount),
  };
};

const attachPartnerOrderSummary = (record) => {
  if (!record || typeof record !== 'object') return record;
  return { ...record, partner_summary: buildPartnerOrderSummary(record) };
};

module.exports = {
  buildPartnerOrderSummary,
  buildPartnerOrderSummaryFromOrderDoc,
  buildPartnerOrderSummaryFromRollup,
  attachPartnerOrderSummary,
  formatPartnerAdditionalCharge,
};
