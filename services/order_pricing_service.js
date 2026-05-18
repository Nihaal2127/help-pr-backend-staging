const mongoose = require("mongoose");
const Service = require("../models/service");
const { OrderCreationError } = require("../errors/order_creation_error");
const {
  loadServiceRates,
  computeBasePricing,
  buildOrderPricingFromService,
  applyPricingToOrder,
  mapPricingToServiceLine,
  comparePricing,
  extractClientPricing,
  resolveTotalServiceCharge,
  roundMoney,
} = require("../utils/order_pricing");
const {
  loadOfferForOrder,
  buildOrderOfferSnapshot,
} = require("./order_offer_service");

const loadServiceForPricing = async (serviceId) => {
  if (!serviceId || !mongoose.Types.ObjectId.isValid(String(serviceId))) {
    throw new OrderCreationError("Valid service_id is required for order pricing.", 409);
  }
  const service = await Service.findOne({
    _id: serviceId,
    deleted_at: null,
    is_active: true,
    approval_status: "approve",
  }).lean();
  if (!service) {
    throw new OrderCreationError("Service not found or not available.", 404);
  }
  return service;
};

const resolveOfferDiscount = async (body, basePricing) => {
  const offerIdRaw = body.offer_id;
  if (
    offerIdRaw === undefined ||
    offerIdRaw === null ||
    String(offerIdRaw).trim() === ""
  ) {
    return { orderOfferSnapshot: null, discount_amount: body.discount_amount ?? null };
  }

  if (
    body.discount_amount !== undefined &&
    body.discount_amount !== null &&
    body.discount_amount !== ""
  ) {
    throw new OrderCreationError(
      "Send offer_id or discount_amount, not both.",
      409
    );
  }

  const offer = await loadOfferForOrder(offerIdRaw, body.order_date);
  const orderOfferSnapshot = buildOrderOfferSnapshot(offer, basePricing);
  return {
    orderOfferSnapshot,
    discount_amount: orderOfferSnapshot.total_discount,
  };
};

/**
 * Resolves pricing from global service rates + total_service_charge (+ optional offer).
 * @returns {{ pricing, pricingMeta, orderOfferSnapshot }}
 */
const resolveOrderPricing = async (body, serviceItem = {}, serviceId = null) => {
  const resolvedServiceId =
    serviceId ?? body.service_id ?? serviceItem.service_id ?? null;

  const totalCharge = resolveTotalServiceCharge(body, serviceItem);
  if (totalCharge === null) {
    throw new OrderCreationError(
      "total_service_charge (or service_price) is required.",
      409
    );
  }

  const service = await loadServiceForPricing(resolvedServiceId);
  const rates = loadServiceRates(service);
  const base = computeBasePricing({
    total_service_charge: totalCharge,
    ...rates,
  });

  const { orderOfferSnapshot, discount_amount } = await resolveOfferDiscount(
    body,
    base
  );

  const pricing = buildOrderPricingFromService(
    service,
    totalCharge,
    discount_amount
  );

  if (orderOfferSnapshot) {
    pricing.discount_percent = orderOfferSnapshot.offer_value;
    pricing.discount_code = orderOfferSnapshot.offer_unique_id || "";
    pricing.discount_reason = orderOfferSnapshot.offer_name || "";
    pricing.offer_id = orderOfferSnapshot.offer_id;
    orderOfferSnapshot.total_discount = pricing.discount_amount;
  }

  const clientValues = extractClientPricing(body, serviceItem);
  const serverValues = {
    total_service_charge: pricing.total_service_charge,
    commission_amount: pricing.commission_amount,
    tax_amount: pricing.tax_amount,
    sub_total: pricing.sub_total,
    total_price: pricing.total_price,
    minimum_deposit_amount: pricing.minimum_deposit_amount,
    discount_amount: pricing.discount_amount,
  };
  const { matches, mismatches } = comparePricing(clientValues, serverValues);

  return {
    pricing,
    orderOfferSnapshot,
    pricingMeta: {
      pricing_source: "server",
      pricing_mismatch: !matches,
      mismatches,
      saved: serverValues,
      ...(orderOfferSnapshot ? { order_offer: orderOfferSnapshot } : {}),
      ...(matches ? {} : { client_sent: clientValues }),
    },
  };
};

const applyPricingToOrderDocument = (order, pricing, adminEarningOverride, orderOfferSnapshot) => {
  let adminEarning =
    adminEarningOverride !== undefined && adminEarningOverride !== null
      ? Number(adminEarningOverride)
      : pricing.commission_amount;

  if (orderOfferSnapshot) {
    adminEarning = Math.max(
      0,
      roundMoney(pricing.commission_amount - orderOfferSnapshot.admin_contribution_amount)
    );
  }

  const withEarning = {
    ...pricing,
    admin_earning: adminEarning,
  };
  applyPricingToOrder(order, withEarning);
  return withEarning;
};

const mapPricingToServiceLineWithOffer = (pricing, orderOfferSnapshot, overrides = {}) => {
  const line = mapPricingToServiceLine(pricing, overrides);
  if (orderOfferSnapshot) {
    line.partner_earning = roundMoney(
      Math.max(
        0,
        pricing.total_service_charge - orderOfferSnapshot.partner_contribution_amount
      )
    );
    line.admin_earning = roundMoney(
      Math.max(
        0,
        pricing.commission_amount - orderOfferSnapshot.admin_contribution_amount
      )
    );
  }
  return line;
};

module.exports = {
  loadServiceForPricing,
  resolveOrderPricing,
  applyPricingToOrderDocument,
  mapPricingToServiceLine,
  mapPricingToServiceLineWithOffer,
};
