/**
 * Quick sanity check for order_pricing.js (run: node scripts/verify-order-pricing.js)
 */
const {
  computeBasePricing,
  computeAdditionalChargeLine,
  computeOrderTotal,
  comparePricing,
  buildOrderPricingFromService,
  finalizeOrderPricing,
  aggregateAdditionalCharges,
} = require("../utils/order_pricing");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// Screenshot example: 3000 service, 10% commission, 10% tax, 25% min deposit
const base = computeBasePricing({
  total_service_charge: 3000,
  tax_percent: 10,
  commission_percent: 10,
  minimum_deposit_percent: 25,
});
assert(base.commission_amount === 300, "commission 300");
assert(base.sub_total === 3300, "subtotal 3300");
assert(base.tax_amount === 330, "tax 330");
assert(base.total_price_before_extras === 3630, "total before extras 3630");
assert(base.minimum_deposit_amount === 907.5, "min deposit 907.5");

// Nursing service sample: 25% commission
const nursing = buildOrderPricingFromService(
  { tax: 10, commission: 25, minimum_deposit: 25 },
  3000
);
assert(nursing.commission_amount === 750, "nursing commission 750");
assert(nursing.sub_total === 3750, "nursing subtotal 3750");
assert(nursing.tax_amount === 375, "nursing tax 375");
assert(nursing.total_price === 4125, "nursing total 4125");
assert(nursing.minimum_deposit_amount === 1031.25, "nursing min deposit");

// Additional charge with tax
const line = computeAdditionalChargeLine(500, 10);
assert(line.tax_amount === 50, "charge tax 50");
assert(line.total_amount === 550, "charge total 550");

const agg = aggregateAdditionalCharges([
  { amount: 500, tax_amount: 50, total_amount: 550 },
]);
const final = finalizeOrderPricing(nursing, agg);
assert(final.total_price === 4675, "total with extra charge");
assert(final.minimum_deposit_amount === 1168.75, "min deposit after extras");

const cmp = comparePricing({ total_price: 3600 }, { total_price: 3630 });
assert(cmp.matches === false && cmp.mismatches.length === 1, "mismatch detect");

console.log("verify-order-pricing: all checks passed");
