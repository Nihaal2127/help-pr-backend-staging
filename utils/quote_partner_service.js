const mongoose = require("mongoose");
const PartnerService = require("../models/partner_service");

const GLOBAL_SERVICE_SELECT =
  "name service_id desc image_url approval_status is_request is_active rejection_reason payment_type";

const partnerServicePopulate = {
  path: "service_id",
  select: GLOBAL_SERVICE_SELECT,
};

const toObjectId = (value) => {
  if (!value) return null;
  const id = value._id ?? value;
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
};

const buildPartnerServiceLookupFilter = (quote) => {
  const partnerId = toObjectId(quote.partner_id);
  const globalServiceId = toObjectId(quote.service_id);
  const categoryId = toObjectId(quote.category_id);

  if (!partnerId || !globalServiceId) return null;

  const filter = {
    partner_id: partnerId,
    service_id: globalServiceId,
    deleted_at: null,
  };
  if (categoryId) {
    filter.category_id = categoryId;
  }
  return filter;
};

const partnerServiceMapKey = (partnerId, globalServiceId, categoryId) =>
  `${partnerId.toString()}-${globalServiceId.toString()}-${categoryId ? categoryId.toString() : ""}`;

const attachPartnerServiceToQuote = async (quote) => {
  const filter = buildPartnerServiceLookupFilter(quote);
  if (!filter) {
    return quote;
  }

  quote.service_id = await PartnerService.findOne(filter)
    .populate(partnerServicePopulate)
    .lean();

  return quote;
};

const attachPartnerServiceToQuotes = async (quotes) => {
  if (!Array.isArray(quotes) || quotes.length === 0) return quotes;

  const lookupFilters = [];
  const seenKeys = new Set();

  for (const quote of quotes) {
    const filter = buildPartnerServiceLookupFilter(quote);
    if (!filter) continue;
    const key = partnerServiceMapKey(
      filter.partner_id,
      filter.service_id,
      filter.category_id
    );
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    lookupFilters.push(filter);
  }

  const partnerServiceByKey = new Map();

  if (lookupFilters.length > 0) {
    const rows = await PartnerService.find({
      deleted_at: null,
      $or: lookupFilters,
    })
      .populate(partnerServicePopulate)
      .lean();

    for (const row of rows) {
      const globalServiceId = row.service_id?._id ?? row.service_id;
      if (!globalServiceId) continue;
      const key = partnerServiceMapKey(
        row.partner_id,
        globalServiceId,
        row.category_id
      );
      partnerServiceByKey.set(key, row);
    }
  }

  for (const quote of quotes) {
    const filter = buildPartnerServiceLookupFilter(quote);
    if (!filter) {
      continue;
    }
    const key = partnerServiceMapKey(
      filter.partner_id,
      filter.service_id,
      filter.category_id
    );
    quote.service_id = partnerServiceByKey.get(key) || null;
  }

  return quotes;
};

module.exports = {
  attachPartnerServiceToQuote,
  attachPartnerServiceToQuotes,
};
