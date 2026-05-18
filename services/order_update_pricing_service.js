const Order = require("../models/order");
const OrderService = require("../models/order_services");
const { OrderCreationError } = require("../errors/order_creation_error");
const { computeBasePricing } = require("../utils/order_pricing");
const {
  loadOfferForOrder,
  buildOrderOfferSnapshot,
  replaceOrderOfferForOrder,
} = require("./order_offer_service");
const {
  applyPricingToOrderDocument,
  mapPricingToServiceLineWithOffer,
} = require("./order_pricing_service");
const { recalculateOrderTotals } = require("../utils/order_financials");
const { ORDER_STATUS_CANCELLED, ORDER_STATUS_REFUNDED } = require("../enum/order_status_enum");

const isOfferClearValue = (value) =>
  value === null ||
  value === false ||
  (typeof value === "string" && value.trim() === "");

const resolveChargeForUpdate = (body, order) => {
  if (body.total_service_charge !== undefined && body.total_service_charge !== null) {
    const n = Number(body.total_service_charge);
    if (!Number.isFinite(n) || n <= 0) {
      throw new OrderCreationError(
        "total_service_charge must be a number greater than 0.",
        409
      );
    }
    return n;
  }
  if (body.service_price !== undefined && body.service_price !== null) {
    const n = Number(body.service_price);
    if (!Number.isFinite(n) || n <= 0) {
      throw new OrderCreationError("service_price must be a number greater than 0.", 409);
    }
    return n;
  }
  const existing = Number(order.total_service_charge ?? order.service_price) || 0;
  if (existing <= 0) {
    throw new OrderCreationError("Order has no total_service_charge to reprice.", 409);
  }
  return existing;
};

const getStoredRatePercents = (order) => {
  const tax_percent = Number(order.tax_percent);
  const commission_percent = Number(order.commission_percent);
  const minimum_deposit_percent = Number(order.minimum_deposit_percent);

  if (!Number.isFinite(tax_percent) && !Number.isFinite(commission_percent)) {
    throw new OrderCreationError(
      "Order is missing stored tax_percent / commission_percent; cannot reprice.",
      409
    );
  }

  return {
    tax_percent: Number.isFinite(tax_percent) ? tax_percent : 0,
    commission_percent: Number.isFinite(commission_percent) ? commission_percent : 0,
    minimum_deposit_percent: Number.isFinite(minimum_deposit_percent)
      ? minimum_deposit_percent
      : 0,
  };
};

/**
 * Resolve which offer applies after update.
 * - offer_id omitted → keep order.offer_id (recompute from offers table)
 * - offer_id null/"" → remove offer
 * - offer_id set → apply that offer
 */
const resolveOfferIdForUpdate = (body, order) => {
  if (!Object.prototype.hasOwnProperty.call(body, "offer_id")) {
    return order.offer_id ? String(order.offer_id) : null;
  }
  if (isOfferClearValue(body.offer_id)) {
    return null;
  }
  return String(body.offer_id).trim();
};

const buildPricingFromOrderRates = async (order, total_service_charge, offerIdRaw) => {
  const rates = getStoredRatePercents(order);

  const preDiscountBase = computeBasePricing({
    total_service_charge,
    ...rates,
    discount_amount: null,
  });

  let orderOfferSnapshot = null;
  let discount_amount = null;

  if (offerIdRaw) {
    const referenceDate = order.order_date || new Date();
    const offer = await loadOfferForOrder(offerIdRaw, referenceDate);
    orderOfferSnapshot = buildOrderOfferSnapshot(offer, preDiscountBase);
    discount_amount = orderOfferSnapshot.total_discount;
  }

  const pricing = computeBasePricing({
    total_service_charge,
    ...rates,
    discount_amount,
  });

  if (orderOfferSnapshot) {
    orderOfferSnapshot.total_service_price = pricing.total_service_charge;
    orderOfferSnapshot.commission_amount = pricing.commission_amount;
    orderOfferSnapshot.total_discount = pricing.discount_amount;
    pricing.discount_percent = orderOfferSnapshot.offer_value;
    pricing.discount_code = orderOfferSnapshot.offer_unique_id || "";
    pricing.discount_reason = orderOfferSnapshot.offer_name || "";
    pricing.offer_id = orderOfferSnapshot.offer_id;
  } else {
    pricing.discount_percent = null;
    pricing.discount_code = "";
    pricing.discount_reason = "";
    pricing.offer_id = null;
  }

  return { pricing, orderOfferSnapshot, rates };
};

const syncOrderServiceLines = async (order, pricing, orderOfferSnapshot) => {
  const linePricing = mapPricingToServiceLineWithOffer(pricing, orderOfferSnapshot);
  const serviceIds = (order.service_items || []).filter(Boolean);

  if (serviceIds.length === 0) return;

  await OrderService.updateMany(
    {
      _id: { $in: serviceIds },
      service_status: { $nin: [ORDER_STATUS_CANCELLED, ORDER_STATUS_REFUNDED] },
    },
    {
      $set: {
        ...linePricing,
        updated_at: new Date(),
      },
    }
  );
};

/**
 * Reprice order using snapshotted % on the order + fresh offer row from offers table.
 */
const repriceOrderOnUpdate = async (order, body) => {
  const total_service_charge = resolveChargeForUpdate(body, order);
  const offerIdRaw = resolveOfferIdForUpdate(body, order);

  const { pricing, orderOfferSnapshot } = await buildPricingFromOrderRates(
    order,
    total_service_charge,
    offerIdRaw
  );

  applyPricingToOrderDocument(order, pricing, undefined, orderOfferSnapshot);

  const orderOfferDoc = await replaceOrderOfferForOrder(order._id, orderOfferSnapshot);
  if (orderOfferDoc) {
    order.order_offer_id = orderOfferDoc._id;
    order.offer_id = orderOfferSnapshot.offer_id;
  } else {
    order.order_offer_id = null;
    order.offer_id = null;
  }

  await order.save();
  await syncOrderServiceLines(order, pricing, orderOfferSnapshot);
  await recalculateOrderTotals(order._id);

  const refreshed = await Order.findById(order._id);
  return {
    order: refreshed,
    pricing,
    order_offer: orderOfferDoc,
    orderOfferSnapshot,
  };
};

const isRepricingRequested = (body) =>
  body.total_service_charge !== undefined ||
  body.service_price !== undefined ||
  Object.prototype.hasOwnProperty.call(body, "offer_id");

module.exports = {
  isRepricingRequested,
  repriceOrderOnUpdate,
};
