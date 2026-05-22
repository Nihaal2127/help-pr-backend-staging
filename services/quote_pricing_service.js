const mongoose = require("mongoose");
const { OrderCreationError } = require("../errors/order_creation_error");
const {
  buildOrderPricingFromService,
  resolveTotalServiceCharge,
} = require("../utils/order_pricing");
const { loadServiceForPricing } = require("./order_pricing_service");

/**
 * Quotes accept only partner base amount (total_service_charge).
 * Commission and tax are derived from the global service rates (no offers / additional charges).
 */
const resolveQuotePricing = async (body) => {
  const serviceId = body?.service_id;
  if (!serviceId || !mongoose.Types.ObjectId.isValid(String(serviceId))) {
    throw new OrderCreationError(
      "Valid service_id is required for quote pricing.",
      409
    );
  }

  const totalCharge = resolveTotalServiceCharge(body, {});
  if (totalCharge === null || totalCharge <= 0) {
    throw new OrderCreationError(
      "total_service_charge (or service_price) is required and must be greater than 0.",
      409
    );
  }

  const service = await loadServiceForPricing(serviceId);
  const pricing = buildOrderPricingFromService(service, totalCharge, null);

  return { pricing, service };
};

const applyPricingToQuote = (quote, pricing) => {
  quote.total_service_charge = pricing.total_service_charge;
  quote.service_price = pricing.total_service_charge;
  quote.commission_percent = pricing.commission_percent;
  quote.commission_amount = pricing.commission_amount;
  quote.tax_percent = pricing.tax_percent;
  quote.tax_amount = pricing.tax_amount;
  quote.sub_total = pricing.sub_total;
  quote.total_price = pricing.total_price;
  quote.minimum_deposit_percent = pricing.minimum_deposit_percent;
  quote.minimum_deposit_amount = pricing.minimum_deposit_amount;
};

const quotePricingInputChanged = (body) =>
  ["total_service_charge", "service_price", "service_id"].some(
    (key) => body[key] !== undefined
  );

const resolveQuoteCharge = (quote, body = {}) => {
  const fromBody = resolveTotalServiceCharge(body, {});
  if (fromBody !== null) return fromBody;
  const stored =
    Number(quote.total_service_charge) || Number(quote.service_price) || 0;
  return stored > 0 ? stored : 0;
};

const buildQuotePricingBody = (quote, body) => ({
  service_id: body.service_id !== undefined ? body.service_id : quote.service_id,
  total_service_charge: resolveQuoteCharge(quote, body) || null,
});

/** True when stored quote lacks a server-computed pricing snapshot. */
const quotePricingSnapshotComplete = (quote) => {
  const charge = resolveQuoteCharge(quote);
  if (!(charge > 0)) return false;
  return (
    Number(quote.total_price) > 0 &&
    Number.isFinite(Number(quote.commission_amount)) &&
    Number.isFinite(Number(quote.tax_amount))
  );
};

/**
 * Validates partner charge and ensures commission/tax snapshot exists before order conversion.
 */
const ensureQuotePricingForConversion = async (quote, body = {}) => {
  const charge = resolveQuoteCharge(quote, body);
  if (!(charge > 0)) {
    throw new OrderCreationError(
      "Quote must have total_service_charge (or service_price) greater than 0 before converting to an order.",
      409
    );
  }

  const needsRecalc =
    quotePricingInputChanged(body) || !quotePricingSnapshotComplete(quote);

  if (needsRecalc) {
    const { pricing } = await resolveQuotePricing({
      service_id: quote.service_id,
      total_service_charge: charge,
      service_price: charge,
    });
    applyPricingToQuote(quote, pricing);
  }

  return { charge };
};

module.exports = {
  resolveQuotePricing,
  applyPricingToQuote,
  quotePricingInputChanged,
  buildQuotePricingBody,
  resolveQuoteCharge,
  quotePricingSnapshotComplete,
  ensureQuotePricingForConversion,
};
