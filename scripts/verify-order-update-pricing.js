/**
 * Unit-style checks for order update repricing (no DB).
 * Run: node scripts/verify-order-update-pricing.js
 */
const { computeBasePricing } = require("../utils/order_pricing");
const { computeOrderOfferBreakdown } = require("../utils/order_offer_pricing");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const orderRates = {
  tax_percent: 10,
  commission_percent: 25,
  minimum_deposit_percent: 25,
};

const charge = 4000;
const pre = computeBasePricing({
  total_service_charge: charge,
  ...orderRates,
  discount_amount: null,
});
assert(pre.commission_amount === 1000, "commission on 4000");

const offer = {
  type: "percentage",
  value: 20,
  admin_contribution: 10,
  partner_contribution: 10,
};
const snap = computeOrderOfferBreakdown(offer, pre);
assert(snap.total_discount === 500, "offer discount on updated charge");

const final = computeBasePricing({
  total_service_charge: charge,
  ...orderRates,
  discount_amount: snap.total_discount,
});
assert(final.discounted_sub_total === 4500, "taxable after offer");
assert(final.tax_amount === 450, "tax after offer on update");
assert(final.total_price_before_extras === 4950, "total after update reprice");

console.log("verify-order-update-pricing: all checks passed");
