/**
 * Quick sanity check for order_pricing.js (run: node scripts/verify-order-pricing.js)
 */
const {
  computeBasePricing,
  computeAdditionalChargeLine,
  comparePricing,
  buildOrderPricingFromService,
  finalizeOrderPricing,
  aggregateAdditionalCharges,
} = require("../utils/order_pricing");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// No discount: tax on full subtotal
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

// Nursing service — no offer
const nursing = buildOrderPricingFromService(
  { tax: 10, commission: 25, minimum_deposit: 25 },
  3000
);
assert(nursing.commission_amount === 750, "nursing commission 750");
assert(nursing.sub_total === 3750, "nursing subtotal 3750");
assert(nursing.tax_amount === 375, "nursing tax 375");
assert(nursing.total_price === 4125, "nursing total 4125");
assert(nursing.minimum_deposit_amount === 1031.25, "nursing min deposit");

// Additional charge: base + commission + tax on (base + commission)
const line = computeAdditionalChargeLine(500, 10, 25);
assert(line.commission_amount === 125, "charge commission 125");
assert(line.tax_amount === 62.5, "charge tax 62.5");
assert(line.total_amount === 687.5, "charge total 687.5");

const agg = aggregateAdditionalCharges([
  {
    amount: 500,
    commission_amount: 125,
    tax_amount: 62.5,
    total_amount: 687.5,
  },
]);
assert(agg.additional_charges_commission === 125, "agg commission");
assert(agg.additional_charges_subtotal === 500, "agg subtotal base only");
const final = finalizeOrderPricing(nursing, agg);
assert(final.total_price === 4812.5, "total with extra charge");
assert(final.tax_amount === 375, "tax unchanged on base after extras");
assert(final.minimum_deposit_amount === 1203.13, "min deposit after extras");

const cmp = comparePricing({ total_price: 3600 }, { total_price: 3630 });
assert(cmp.matches === false && cmp.mismatches.length === 1, "mismatch detect");

const { computeOrderOfferBreakdown } = require("../utils/order_offer_pricing");

const offer = {
  type: "percentage",
  value: 20,
  admin_contribution: 10,
  partner_contribution: 10,
  unique_id: "OFF1001",
  name: "Summer Sale",
};
const offerBreakdown = computeOrderOfferBreakdown(offer, {
  total_service_charge: 3000,
  commission_amount: 750,
});
assert(offerBreakdown.admin_contribution_amount === 75, "admin offer share 75");
assert(offerBreakdown.partner_contribution_amount === 300, "partner offer share 300");
assert(offerBreakdown.total_discount === 375, "total offer discount 375");

// Tax AFTER offer: taxable = 3750 - 375 = 3375, tax = 337.50, total = 3712.50
const pricedWithOffer = buildOrderPricingFromService(
  { tax: 10, commission: 25, minimum_deposit: 25 },
  3000,
  offerBreakdown.total_discount
);
assert(pricedWithOffer.discounted_sub_total === 3375, "taxable subtotal after offer");
assert(pricedWithOffer.tax_amount === 337.5, "tax after offer");
assert(pricedWithOffer.total_price === 3712.5, "total after offer (post-tax)");

console.log("verify-order-pricing: all checks passed");
