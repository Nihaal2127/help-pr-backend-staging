const mongoose = require("mongoose");
const Offer = require("../models/offer");
const OrderOffer = require("../models/order_offer");
const { OrderCreationError } = require("../errors/order_creation_error");
const {
  computeOrderOfferBreakdown,
  isOfferValidOnDate,
} = require("../utils/order_offer_pricing");

const loadOfferForOrder = async (offerIdRaw, referenceDate) => {
  if (!offerIdRaw || !mongoose.Types.ObjectId.isValid(String(offerIdRaw))) {
    throw new OrderCreationError("Valid offer_id is required when applying an offer.", 409);
  }

  const offer = await Offer.findOne({
    _id: offerIdRaw,
    deleted_at: null,
    is_active: true,
  }).lean();

  if (!offer) {
    throw new OrderCreationError("Offer not found or is not active.", 404);
  }

  const refDate =
    referenceDate !== undefined && referenceDate !== null && referenceDate !== ""
      ? new Date(referenceDate)
      : new Date();

  if (!isOfferValidOnDate(offer, refDate)) {
    throw new OrderCreationError(
      "Offer is not valid for this order date.",
      409
    );
  }

  return offer;
};

/**
 * @param {object} offer - lean offer document
 * @param {object} basePricing - output of computeBasePricing
 */
const buildOrderOfferSnapshot = (offer, basePricing) => {
  const snapshot = computeOrderOfferBreakdown(offer, basePricing);
  if (snapshot.total_discount <= 0) {
    throw new OrderCreationError("Offer does not produce a discount for this order.", 409);
  }
  return snapshot;
};

const snapshotToOrderOfferFields = (orderId, snapshot) => ({
  order_id: orderId,
  offer_id: snapshot.offer_id,
  offer_unique_id: snapshot.offer_unique_id || "",
  offer_name: snapshot.offer_name || "",
  offer_type: snapshot.offer_type || "percentage",
  offer_value: snapshot.offer_value ?? 0,
  total_service_price: snapshot.total_service_price,
  commission_amount: snapshot.commission_amount,
  admin_contribution: snapshot.admin_contribution,
  partner_contribution: snapshot.partner_contribution,
  admin_contribution_amount: snapshot.admin_contribution_amount,
  partner_contribution_amount: snapshot.partner_contribution_amount,
  total_discount: snapshot.total_discount,
  updated_at: new Date(),
});

const createOrderOfferRecord = async (orderId, snapshot) => {
  const doc = new OrderOffer({
    ...snapshotToOrderOfferFields(orderId, snapshot),
    created_at: new Date(),
  });
  await doc.save();
  return doc;
};

/**
 * Replace order_offer entirely from fresh snapshot (update flow).
 * Pass null snapshot to remove offer from order.
 */
const replaceOrderOfferForOrder = async (orderId, snapshot) => {
  if (!snapshot) {
    await OrderOffer.deleteOne({ order_id: orderId });
    return null;
  }

  const fields = snapshotToOrderOfferFields(orderId, snapshot);
  const doc = await OrderOffer.findOneAndUpdate(
    { order_id: orderId },
    {
      $set: fields,
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true, new: true }
  );
  return doc;
};

module.exports = {
  loadOfferForOrder,
  buildOrderOfferSnapshot,
  createOrderOfferRecord,
  replaceOrderOfferForOrder,
};
