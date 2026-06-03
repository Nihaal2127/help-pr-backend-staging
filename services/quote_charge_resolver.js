const mongoose = require("mongoose");
const PartnerService = require("../models/partner_service");
const { resolveTotalServiceCharge } = require("../utils/order_pricing");

const toObjectId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const id = value._id ?? value;
  if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
  return new mongoose.Types.ObjectId(String(id));
};

const positivePrice = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const hasPartnerId = (partnerId) =>
  partnerId !== undefined && partnerId !== null && String(partnerId).trim() !== "";

const loadPartnerServicePrice = async ({ partnerId, serviceId, categoryId }) => {
  const partnerOid = toObjectId(partnerId);
  const serviceOid = toObjectId(serviceId);
  if (!partnerOid || !serviceOid) return null;

  const filter = {
    partner_id: partnerOid,
    service_id: serviceOid,
    deleted_at: null,
  };
  const categoryOid = toObjectId(categoryId);
  if (categoryOid) {
    filter.category_id = categoryOid;
  }

  const row = await PartnerService.findOne(filter).select("price").lean();
  return positivePrice(row?.price);
};

/**
 * Resolves quote base amount (total_service_charge).
 * Without partner_id: always 0 (pricing is set when a partner is assigned on update).
 * With partner_id: explicit body charge, else that partner's partner_service.price.
 */
const resolveQuoteBaseCharge = async (body = {}) => {
  if (!hasPartnerId(body.partner_id)) {
    return 0;
  }

  const fromClient = resolveTotalServiceCharge(body, {});
  if (fromClient !== null && fromClient > 0) return fromClient;

  return loadPartnerServicePrice({
    partnerId: body.partner_id,
    serviceId: body.service_id,
    categoryId: body.category_id,
  });
};

module.exports = {
  resolveQuoteBaseCharge,
  loadPartnerServicePrice,
  hasPartnerId,
};
