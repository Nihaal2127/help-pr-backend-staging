const { roundMoney, clampMoney } = require("./order_pricing");

/**
 * Percentage offer: admin share from commission, partner share from service charge.
 *   admin_contribution_amount   = commission_amount × admin_contribution%
 *   partner_contribution_amount = total_service_price × partner_contribution%
 *   total_discount = sum of both
 */
const computePercentageOfferBreakdown = (
  offer,
  { total_service_price, commission_amount }
) => {
  const charge = clampMoney(total_service_price);
  const commission = clampMoney(commission_amount);
  const adminPct = Number(offer.admin_contribution) || 0;
  const partnerPct = Number(offer.partner_contribution) || 0;

  const admin_contribution_amount = roundMoney((commission * adminPct) / 100);
  const partner_contribution_amount = roundMoney((charge * partnerPct) / 100);
  const total_discount = roundMoney(
    admin_contribution_amount + partner_contribution_amount
  );

  return {
    admin_contribution: adminPct,
    partner_contribution: partnerPct,
    admin_contribution_amount,
    partner_contribution_amount,
    total_discount,
  };
};

/**
 * Fixed offer: flat total_discount = offer.value (capped at subtotal before tax is not applied here;
 * caller caps against total_price_before_extras when applying to order).
 */
const computeFixedOfferBreakdown = (offer, { total_service_price, commission_amount }) => {
  const charge = clampMoney(total_service_price);
  const commission = clampMoney(commission_amount);
  const total_discount = clampMoney(Number(offer.value) || 0);
  const adminPct = Number(offer.admin_contribution) || 0;
  const partnerPct = Number(offer.partner_contribution) || 0;
  const pctSum = adminPct + partnerPct;

  let admin_contribution_amount = 0;
  let partner_contribution_amount = 0;
  if (pctSum > 0) {
    admin_contribution_amount = roundMoney((total_discount * adminPct) / pctSum);
    partner_contribution_amount = roundMoney(total_discount - admin_contribution_amount);
  } else {
    admin_contribution_amount = roundMoney(total_discount / 2);
    partner_contribution_amount = roundMoney(total_discount - admin_contribution_amount);
  }

  return {
    admin_contribution: adminPct,
    partner_contribution: partnerPct,
    admin_contribution_amount,
    partner_contribution_amount,
    total_discount,
    total_service_price: charge,
    commission_amount: commission,
  };
};

const computeOrderOfferBreakdown = (offer, basePricing) => {
  const total_service_price = clampMoney(basePricing.total_service_charge);
  const commission_amount = clampMoney(basePricing.commission_amount);
  const type = String(offer.type || "percentage").toLowerCase();

  let breakdown;
  if (type === "fixed") {
    breakdown = computeFixedOfferBreakdown(offer, {
      total_service_price,
      commission_amount,
    });
  } else {
    breakdown = computePercentageOfferBreakdown(offer, {
      total_service_price,
      commission_amount,
    });
  }

  return {
    offer_id: offer._id,
    offer_unique_id: offer.unique_id || "",
    offer_name: offer.name || "",
    offer_type: type,
    offer_value: Number(offer.value) || 0,
    total_service_price,
    commission_amount,
    ...breakdown,
  };
};

const startOfDayUtc = (d) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

const endOfDayUtc = (d) => {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
};

const isOfferValidOnDate = (offer, referenceDate) => {
  const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (Number.isNaN(ref.getTime())) return false;
  const start = startOfDayUtc(offer.start_date);
  const end = endOfDayUtc(offer.end_date);
  return ref >= start && ref <= end;
};

module.exports = {
  computePercentageOfferBreakdown,
  computeFixedOfferBreakdown,
  computeOrderOfferBreakdown,
  isOfferValidOnDate,
};
