const mongoose = require('mongoose');
const Service = require('../../../models/service');
const OrderService = require('../../../models/order_services');
const PartnerServiceRating = require('../../../models/partner_service_rating');
const { applyPagination } = require('../../../utils/pagination');
const { mapRatingSummary } = require('../../../utils/rating_format');
const { fieldLabel } = require('../../../utils/field_labels');
const { fail, ok, parsePositiveInt } = require('../../../utils/mobile_service_result');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const isPopulatedDoc = (value) =>
  Boolean(value) && typeof value === 'object' && value._id && !(value instanceof mongoose.Types.ObjectId);

const parseRequiredServiceId = (raw) => {
  const serviceKey = String(raw ?? '').trim();
  if (!serviceKey) {
    return fail(400, `${fieldLabel('service_id')} is required.`);
  }
  if (!mongoose.Types.ObjectId.isValid(serviceKey)) {
    return fail(400, `${fieldLabel('service_id')} must be a valid ObjectId.`);
  }
  return ok(200, { serviceOid: new mongoose.Types.ObjectId(serviceKey) });
};

const parseListPagination = (query = {}) => {
  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(parsePositiveInt(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  return { page, limit };
};

const mapCustomerRatingRow = (line) => {
  const customer = isPopulatedDoc(line.user_id) ? line.user_id : null;
  const service = isPopulatedDoc(line.service_id) ? line.service_id : null;
  const ratingValue = Number(line.rating);

  return {
    service_id: service?._id ?? line.service_id ?? null,
    service_name: service?.name ?? null,
    customer_name: customer?.name ?? null,
    customer_profile_url: customer?.profile_url || null,
    rating: Number.isFinite(ratingValue) && ratingValue > 0 ? ratingValue : 0,
    review_text: line.review_text || '',
    reviewed_at: line.reviewed_at || null,
  };
};

const mapPartnerRatingRow = (line) => {
  const customer = isPopulatedDoc(line.user_id) ? line.user_id : null;
  const service = isPopulatedDoc(line.service_id) ? line.service_id : null;
  const ratingValue = Number(line.rating);

  return {
    order_id: line.order_id ?? null,
    order_unique_id: line.order_unique_id || null,
    user_id: customer?._id ?? line.user_id ?? null,
    user_unique_id: line.user_unique_id || customer?.user_id || null,
    customer_name: customer?.name ?? null,
    customer_phone_number: customer?.phone_number ?? null,
    customer_profile_url: customer?.profile_url || null,
    service_id: service?._id ?? line.service_id ?? null,
    service_name: service?.name ?? null,
    rating: Number.isFinite(ratingValue) && ratingValue > 0 ? ratingValue : 0,
    review_text: line.review_text || '',
    reviewed_at: line.reviewed_at || null,
  };
};

/**
 * Paginated per-order ratings for one partner + service.
 * `includeCustomerContact` adds order/customer identifiers for the partner app.
 */
const listPartnerServiceOrderRatings = async ({
  partner,
  query = {},
  includeCustomerContact = false,
}) => {
  const serviceIdResult = parseRequiredServiceId(query.service_id);
  if (!serviceIdResult.ok) return serviceIdResult;

  const { serviceOid } = serviceIdResult.data;
  const service = await Service.findOne({ _id: serviceOid, deleted_at: null })
    .select('name service_id')
    .lean();

  if (!service) {
    return fail(404, 'Service not found.');
  }

  const { page, limit } = parseListPagination(query);
  const filter = {
    partner_id: partner._id,
    service_id: serviceOid,
    deleted_at: null,
    rating: { $gt: 0 },
  };

  const { data, totalCount, totalPages, currentPage } = await applyPagination(
    OrderService,
    filter,
    page,
    limit,
    { reviewed_at: -1, created_at: -1 },
    {
      order_id: 1,
      order_unique_id: 1,
      user_id: 1,
      user_unique_id: 1,
      service_id: 1,
      rating: 1,
      review_text: 1,
      reviewed_at: 1,
    },
    [
      { path: 'user_id', select: 'name phone_number user_id profile_url' },
      { path: 'service_id', select: 'name service_id' },
    ]
  );

  const partnerServiceRow = await PartnerServiceRating.findOne({
    partner_id: partner._id,
    service_id: serviceOid,
    deleted_at: null,
  })
    .select('average_rating rating_count')
    .lean();

  const mapRow = includeCustomerContact ? mapPartnerRatingRow : mapCustomerRatingRow;

  return ok(200, {
    message: 'Partner service ratings fetched successfully.',
    totalItems: totalCount,
    totalPages,
    currentPage,
    limit,
    record: {
      partner_id: partner._id,
      partner_name: partner.name ?? null,
      service_id: service._id,
      service_name: service.name ?? null,
      service_code: service.service_id || null,
      ...mapRatingSummary(partnerServiceRow),
    },
    records: (data || []).map(mapRow),
  });
};

module.exports = {
  listPartnerServiceOrderRatings,
};
