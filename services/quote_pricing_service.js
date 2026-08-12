const mongoose = require("mongoose");
const { OrderCreationError } = require("../errors/order_creation_error");
const { fieldLabel } = require("../utils/field_labels");
const {
  buildOrderPricingFromService,
  resolveTotalServiceCharge,
} = require("../utils/order_pricing");
const { loadServiceForPricing } = require("./order_pricing_service");
const {
  resolveQuoteBaseCharge,
  hasPartnerId,
} = require("./quote_charge_resolver");

/**
 * Quotes accept partner base amount (total_service_charge).
 * Without partner: charge is 0 until a partner is assigned (update).
 * With partner: charge from body or partner_service.price; commission/tax from global service rates.
 */
const resolveQuotePricing = async (body) => {
  const serviceId = body?.service_id;
  if (!serviceId || !mongoose.Types.ObjectId.isValid(String(serviceId))) {
    throw new OrderCreationError(
      `Valid ${fieldLabel("service_id")} is required for quote pricing.`,
      409
    );
  }

  const totalCharge = await resolveQuoteBaseCharge(body);

  if (!hasPartnerId(body.partner_id)) {
    const service = await loadServiceForPricing(serviceId);
    const pricing = buildOrderPricingFromService(service, 0, null);
    return { pricing, service };
  }

  if (totalCharge === null || totalCharge <= 0) {
    throw new OrderCreationError(
      `Unable to determine service price for the selected partner. Ensure the partner offers this service or send ${fieldLabel("total_service_charge")}.`,
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
  ["total_service_charge", "service_price", "service_id", "partner_id"].some(
    (key) => body[key] !== undefined
  );

const resolveQuoteCharge = (quote, body = {}) => {
  const fromBody = resolveTotalServiceCharge(body, {});
  if (fromBody !== null) return fromBody;
  const stored =
    Number(quote.total_service_charge) || Number(quote.service_price) || 0;
  return stored > 0 ? stored : 0;
};

const sameRefId = (a, b) => {
  const left = a == null || a === "" ? null : String(a._id ?? a);
  const right = b == null || b === "" ? null : String(b._id ?? b);
  return left === right;
};

const buildQuotePricingBody = (quote, body) => {
  const partnerId =
    body.partner_id !== undefined ? body.partner_id : quote.partner_id;
  const serviceId =
    body.service_id !== undefined ? body.service_id : quote.service_id;
  const categoryId =
    body.category_id !== undefined ? body.category_id : quote.category_id;

  // Admin edit forms often resend partner_id / service_id even when unchanged.
  // Only fall back to partner_service.price (1 unit) when partner/service
  // actually changes and the client did not send an explicit booked-hours charge.
  const partnerOrServiceChanged =
    (body.partner_id !== undefined &&
      !sameRefId(body.partner_id, quote.partner_id)) ||
    (body.service_id !== undefined &&
      !sameRefId(body.service_id, quote.service_id));

  const explicitCharge = resolveTotalServiceCharge(body, {});
  const hasExplicitCharge =
    explicitCharge !== null && explicitCharge > 0;

  const reloadFromPartnerOffering =
    hasPartnerId(partnerId) &&
    partnerOrServiceChanged &&
    !hasExplicitCharge;

  return {
    service_id: serviceId,
    partner_id: partnerId,
    category_id: categoryId,
    total_service_charge: reloadFromPartnerOffering
      ? null
      : resolveQuoteCharge(quote, body) || null,
  };
};

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
      `Quote must have ${fieldLabel("total_service_charge")} (or ${fieldLabel("service_price")}) greater than 0 before converting to an order.`,
      409
    );
  }

  const needsRecalc =
    quotePricingInputChanged(body) || !quotePricingSnapshotComplete(quote);

  if (needsRecalc) {
    const { pricing } = await resolveQuotePricing(
      buildQuotePricingBody(quote, {
        total_service_charge: charge,
        service_price: charge,
      })
    );
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
