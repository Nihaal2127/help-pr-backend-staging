/**
 * Server-side order pricing from global service rates + total_service_charge.
 *
 * Flow (tax after offer / discount):
 *   commission_amount = total_service_charge × commission%
 *   sub_total         = total_service_charge + commission_amount
 *   discount          = offer total_discount (optional)
 *   taxable_subtotal  = sub_total − discount
 *   tax_amount        = taxable_subtotal × tax%
 *   total             = taxable_subtotal + tax_amount
 */

const { applyInitialPaymentStatusFields } = require("./order_payment_initial_status");

const PRICING_TOLERANCE = 0.01;

const roundMoney = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

const clampMoney = (value) => Math.max(0, roundMoney(value));

const loadServiceRates = (service) => ({
  tax_percent: Number(service?.tax) || 0,
  commission_percent: Number(service?.commission) || 0,
  minimum_deposit_percent: Number(service?.minimum_deposit) || 0,
});

const normalizeDiscount = (discount_amount, sub_total) => {
  const disc =
    discount_amount !== null && discount_amount !== undefined
      ? Number(discount_amount)
      : 0;
  if (!Number.isFinite(disc) || disc <= 0) {
    return { applied: 0, discounted_sub_total: clampMoney(sub_total) };
  }
  const applied = clampMoney(Math.min(disc, sub_total));
  return {
    applied,
    discounted_sub_total: clampMoney(sub_total - applied),
  };
};

/**
 * Tax is calculated on sub_total AFTER discount (post-offer taxable base).
 */
const computeTaxAndTotalFromSubtotal = (
  sub_total,
  discount_amount,
  tax_percent
) => {
  const { applied, discounted_sub_total } = normalizeDiscount(
    discount_amount,
    sub_total
  );
  const taxPct = Number(tax_percent) || 0;
  const tax_amount = roundMoney((discounted_sub_total * taxPct) / 100);
  const total_price_before_extras = roundMoney(
    discounted_sub_total + tax_amount
  );

  return {
    discount_amount: applied > 0 ? applied : null,
    discounted_sub_total,
    tax_amount,
    total_price_before_extras,
  };
};

/**
 * @param {number} total_service_charge
 * @param {{ tax_percent, commission_percent, minimum_deposit_percent, discount_amount? }} params
 */
const computeBasePricing = ({
  total_service_charge,
  tax_percent,
  commission_percent,
  minimum_deposit_percent,
  discount_amount = null,
}) => {
  const charge = clampMoney(total_service_charge);
  const commission_amount = roundMoney(
    (charge * (Number(commission_percent) || 0)) / 100
  );
  const sub_total = roundMoney(charge + commission_amount);

  const taxBlock = computeTaxAndTotalFromSubtotal(
    sub_total,
    discount_amount,
    tax_percent
  );

  const minimum_deposit_amount = roundMoney(
    (taxBlock.total_price_before_extras *
      (Number(minimum_deposit_percent) || 0)) /
      100
  );

  return {
    total_service_charge: charge,
    commission_percent: Number(commission_percent) || 0,
    commission_amount,
    tax_percent: Number(tax_percent) || 0,
    sub_total,
    ...taxBlock,
    minimum_deposit_percent: Number(minimum_deposit_percent) || 0,
    minimum_deposit_amount,
  };
};

/**
 * Additional charge line: partner base + commission + tax on (base + commission).
 * Customer pays total_amount; partner wallet credits base amount only.
 */
const computeAdditionalChargeLine = (amount, tax_percent, commission_percent = 0) => {
  const base = clampMoney(amount);
  const commissionPct = Number(commission_percent) || 0;
  const commission_amount = roundMoney((base * commissionPct) / 100);
  const taxable = roundMoney(base + commission_amount);
  const tax_amount = roundMoney((taxable * (Number(tax_percent) || 0)) / 100);
  const total_amount = roundMoney(taxable + tax_amount);
  return {
    amount: base,
    commission_percent: commissionPct,
    commission_amount,
    tax_percent: Number(tax_percent) || 0,
    tax_amount,
    total_amount,
  };
};

/**
 * Customer total: taxable subtotal + tax on that base + taxed additional charges.
 */
const computeOrderTotal = (orderLike, additionalChargesTotal = 0) => {
  const sub = Number(orderLike.sub_total) || 0;
  const add = Number(additionalChargesTotal) || 0;
  const disc =
    orderLike.discount_amount !== null && orderLike.discount_amount !== undefined
      ? Number(orderLike.discount_amount)
      : 0;

  const usesLegacyFees =
    (orderLike.tax_percent === undefined || orderLike.tax_percent === null) &&
    (Number(orderLike.user_paltform_fee) || 0) +
      (Number(orderLike.partner_commison_platform_fee) || 0) >
      0;

  if (usesLegacyFees) {
    const taxAmount =
      orderLike.tax_amount !== undefined && orderLike.tax_amount !== null
        ? Number(orderLike.tax_amount)
        : Number(orderLike.tax) || 0;
    const userFee = Number(orderLike.user_paltform_fee) || 0;
    const partnerFee = Number(orderLike.partner_commison_platform_fee) || 0;
    let total = sub + taxAmount + userFee + partnerFee + add - disc;
    return clampMoney(total);
  }

  const taxPct = Number(orderLike.tax_percent) || 0;
  if (taxPct > 0 || disc > 0) {
    const { total_price_before_extras } = computeTaxAndTotalFromSubtotal(
      sub,
      disc > 0 ? disc : null,
      taxPct
    );
    return clampMoney(total_price_before_extras + add);
  }

  const taxAmount =
    orderLike.tax_amount !== undefined && orderLike.tax_amount !== null
      ? Number(orderLike.tax_amount)
      : Number(orderLike.tax) || 0;
  return clampMoney(sub + taxAmount + add - disc);
};

const computeMinimumDepositAmount = (total_price, minimum_deposit_percent) =>
  roundMoney(
    (clampMoney(total_price) * (Number(minimum_deposit_percent) || 0)) / 100
  );

const COMPARE_FIELDS = [
  "total_service_charge",
  "commission_amount",
  "tax_amount",
  "sub_total",
  "total_price",
  "minimum_deposit_amount",
  "discount_amount",
];

const comparePricing = (clientValues = {}, serverValues = {}, tolerance = PRICING_TOLERANCE) => {
  const mismatches = [];
  for (const key of COMPARE_FIELDS) {
    if (clientValues[key] === undefined || clientValues[key] === null) continue;
    const clientNum = Number(clientValues[key]);
    const serverNum = Number(serverValues[key]);
    if (!Number.isFinite(clientNum) || !Number.isFinite(serverNum)) continue;
    if (Math.abs(clientNum - serverNum) > tolerance) {
      mismatches.push({
        field: key,
        client: roundMoney(clientNum),
        server: roundMoney(serverNum),
      });
    }
  }
  return { matches: mismatches.length === 0, mismatches };
};

const extractClientPricing = (body = {}, serviceItem = {}) => ({
  total_service_charge:
    body.total_service_charge ??
    body.service_price ??
    serviceItem.total_service_charge ??
    serviceItem.service_price,
  commission_amount:
    body.commission_amount ?? body.admin_commission ?? serviceItem.commission_amount,
  tax_amount: body.tax_amount ?? serviceItem.tax_amount,
  sub_total: body.sub_total ?? serviceItem.sub_total,
  total_price: body.total_price ?? serviceItem.total_price,
  minimum_deposit_amount:
    body.minimum_deposit_amount ?? body.min_deposit ?? serviceItem.minimum_deposit_amount,
  discount_amount: body.discount_amount ?? serviceItem.discount_amount,
});

const resolveTotalServiceCharge = (body = {}, serviceItem = {}) => {
  const raw =
    body.total_service_charge ??
    body.service_price ??
    serviceItem.total_service_charge ??
    serviceItem.service_price;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

/**
 * Build authoritative pricing from service document + charge input.
 */
const buildOrderPricingFromService = (service, total_service_charge, discount_amount = null) => {
  const rates = loadServiceRates(service);
  const pricing = computeBasePricing({
    total_service_charge,
    ...rates,
    discount_amount,
  });

  return {
    ...pricing,
    ...rates,
    additional_charges_subtotal: 0,
    additional_charges_commission: 0,
    additional_charges_tax: 0,
    additional_charges_total: 0,
    total_price: pricing.total_price_before_extras,
    minimum_deposit_amount: pricing.minimum_deposit_amount,
  };
};

/**
 * Apply pricing snapshot onto an order mongoose document / plain object.
 */
const applyPricingToOrder = (order, pricing) => {
  order.total_service_charge = pricing.total_service_charge;
  order.service_price = pricing.total_service_charge;
  order.commission_percent = pricing.commission_percent;
  order.commission_amount = pricing.commission_amount;
  order.admin_commission = pricing.commission_amount;
  order.tax_percent = pricing.tax_percent;
  order.tax_amount = pricing.tax_amount;
  order.tax = pricing.tax_amount;
  order.sub_total = pricing.sub_total;
  order.minimum_deposit_percent = pricing.minimum_deposit_percent;
  order.minimum_deposit_amount = pricing.minimum_deposit_amount;
  order.min_deposit = pricing.minimum_deposit_amount;
  order.user_paltform_fee = 0;
  order.partner_commison_platform_fee = pricing.commission_amount;
  order.additional_charges_subtotal = pricing.additional_charges_subtotal ?? 0;
  order.additional_charges_commission = pricing.additional_charges_commission ?? 0;
  order.additional_charges_tax = pricing.additional_charges_tax ?? 0;
  order.additional_charges_total = pricing.additional_charges_total ?? 0;
  order.total_price = pricing.total_price;
  order.discount_amount =
    pricing.discount_amount !== undefined && pricing.discount_amount !== null
      ? pricing.discount_amount
      : null;
  if (pricing.discount_percent !== undefined) {
    order.discount_percent = pricing.discount_percent;
  }
  if (pricing.discount_code !== undefined) {
    order.discount_code = pricing.discount_code;
  }
  if (pricing.discount_reason !== undefined) {
    order.discount_reason = pricing.discount_reason;
  }
  if (pricing.offer_id !== undefined) {
    order.offer_id = pricing.offer_id;
  }
  if (pricing.order_offer_id !== undefined) {
    order.order_offer_id = pricing.order_offer_id;
  }
  order.admin_earning =
    pricing.admin_earning !== undefined
      ? pricing.admin_earning
      : pricing.commission_amount;

  if (
    order.payment_status === undefined ||
    order.payment_status === null ||
    order.user_payment_status === undefined ||
    order.user_payment_status === null
  ) {
    applyInitialPaymentStatusFields(order, pricing.total_price ?? 0);
  } else if (order.customer_due_amount === undefined || order.customer_due_amount === null) {
    order.customer_due_amount = pricing.total_price ?? 0;
  }
};

const mapPricingToServiceLine = (pricing, overrides = {}) => ({
  total_service_charge: pricing.total_service_charge,
  service_price: pricing.total_service_charge,
  commission_percent: pricing.commission_percent,
  commission_amount: pricing.commission_amount,
  tax_percent: pricing.tax_percent,
  tax_amount: pricing.tax_amount,
  tax: pricing.tax_amount,
  sub_total: pricing.sub_total,
  user_paltform_fee: 0,
  partner_commison_platform_fee: pricing.commission_amount,
  total_price: pricing.total_price,
  partner_earning:
    overrides.partner_earning !== undefined
      ? overrides.partner_earning
      : pricing.total_service_charge,
  admin_earning:
    overrides.admin_earning !== undefined
      ? overrides.admin_earning
      : pricing.commission_amount,
});

const aggregateAdditionalCharges = (rows = []) => {
  let additional_charges_subtotal = 0;
  let additional_charges_commission = 0;
  let additional_charges_tax = 0;
  let additional_charges_total = 0;

  for (const row of rows) {
    const base = Number(row.amount) || 0;
    const commissionAmt =
      row.commission_amount !== undefined && row.commission_amount !== null
        ? Number(row.commission_amount)
        : 0;
    const taxAmt =
      row.tax_amount !== undefined && row.tax_amount !== null
        ? Number(row.tax_amount)
        : 0;
    const total =
      row.total_amount !== undefined && row.total_amount !== null
        ? Number(row.total_amount)
        : base + commissionAmt + taxAmt;
    additional_charges_subtotal += base;
    additional_charges_commission += commissionAmt;
    additional_charges_tax += taxAmt;
    additional_charges_total += total;
  }

  return {
    additional_charges_subtotal: roundMoney(additional_charges_subtotal),
    additional_charges_commission: roundMoney(additional_charges_commission),
    additional_charges_tax: roundMoney(additional_charges_tax),
    additional_charges_total: roundMoney(additional_charges_total),
  };
};

const finalizeOrderPricing = (basePricing, additionalAgg, discount_amount = null) => {
  const disc =
    discount_amount !== null && discount_amount !== undefined
      ? Number(discount_amount)
      : basePricing.discount_amount
        ? Number(basePricing.discount_amount)
        : 0;

  const taxBlock = computeTaxAndTotalFromSubtotal(
    basePricing.sub_total,
    disc > 0 ? disc : null,
    basePricing.tax_percent
  );

  const total_price = clampMoney(
    taxBlock.total_price_before_extras + additionalAgg.additional_charges_total
  );

  const minimum_deposit_amount = computeMinimumDepositAmount(
    total_price,
    basePricing.minimum_deposit_percent
  );

  return {
    ...basePricing,
    ...taxBlock,
    ...additionalAgg,
    total_price,
    minimum_deposit_amount,
  };
};

module.exports = {
  PRICING_TOLERANCE,
  roundMoney,
  clampMoney,
  loadServiceRates,
  normalizeDiscount,
  computeTaxAndTotalFromSubtotal,
  computeBasePricing,
  computeAdditionalChargeLine,
  computeOrderTotal,
  computeMinimumDepositAmount,
  comparePricing,
  extractClientPricing,
  resolveTotalServiceCharge,
  buildOrderPricingFromService,
  applyPricingToOrder,
  mapPricingToServiceLine,
  aggregateAdditionalCharges,
  finalizeOrderPricing,
};
