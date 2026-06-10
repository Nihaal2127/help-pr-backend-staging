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

/** Same shape from order rollups (e.g. after additional-charge CRUD). */
const buildPartnerOrderSummaryFromRollup = (order) => {
  if (!order || typeof order !== 'object') return null;

  const additionalChargesEarning = roundMoney(order.additional_charges_subtotal);
  const paidAmount = roundMoney(order.partner_paid_amount);
  const dueAmount = roundMoney(order.partner_due_amount);
  const totalEarning = roundMoney(paidAmount + dueAmount);
  const serviceEarning = roundMoney(Math.max(0, totalEarning - additionalChargesEarning));

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

const attachPartnerOrderSummary = (record) => {
  if (!record || typeof record !== 'object') return record;
  return { ...record, partner_summary: buildPartnerOrderSummary(record) };
};

module.exports = {
  buildPartnerOrderSummary,
  buildPartnerOrderSummaryFromRollup,
  attachPartnerOrderSummary,
};
