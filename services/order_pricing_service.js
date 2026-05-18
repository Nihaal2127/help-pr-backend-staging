const mongoose = require("mongoose");
const Service = require("../models/service");
const { OrderCreationError } = require("../errors/order_creation_error");
const {
  buildOrderPricingFromService,
  applyPricingToOrder,
  mapPricingToServiceLine,
  comparePricing,
  extractClientPricing,
  resolveTotalServiceCharge,
} = require("../utils/order_pricing");

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

/**
 * Resolves pricing from global service rates + total_service_charge.
 * @returns {{ pricing, pricingMeta }}
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
  const pricing = buildOrderPricingFromService(
    service,
    totalCharge,
    body.discount_amount
  );

  const clientValues = extractClientPricing(body, serviceItem);
  const serverValues = {
    total_service_charge: pricing.total_service_charge,
    commission_amount: pricing.commission_amount,
    tax_amount: pricing.tax_amount,
    sub_total: pricing.sub_total,
    total_price: pricing.total_price,
    minimum_deposit_amount: pricing.minimum_deposit_amount,
  };
  const { matches, mismatches } = comparePricing(clientValues, serverValues);

  return {
    pricing,
    pricingMeta: {
      pricing_source: "server",
      pricing_mismatch: !matches,
      mismatches,
      saved: serverValues,
      ...(matches ? {} : { client_sent: clientValues }),
    },
  };
};

const applyPricingToOrderDocument = (order, pricing, adminEarningOverride) => {
  const withEarning = {
    ...pricing,
    admin_earning:
      adminEarningOverride !== undefined && adminEarningOverride !== null
        ? Number(adminEarningOverride)
        : pricing.commission_amount,
  };
  applyPricingToOrder(order, withEarning);
  return withEarning;
};

module.exports = {
  loadServiceForPricing,
  resolveOrderPricing,
  applyPricingToOrderDocument,
  mapPricingToServiceLine,
};
