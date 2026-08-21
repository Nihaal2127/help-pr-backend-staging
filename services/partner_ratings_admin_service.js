const mongoose = require('mongoose');
const User = require('../models/user');
const OrderService = require('../models/order_services');
const { USER_TYPE_PARTNER } = require('../constants/user_types');
const { applyPagination } = require('../utils/pagination');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const { fieldLabel } = require('../utils/field_labels');
const { mapRatingSummary } = require('../utils/rating_format');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const DEFAULT_PAGE = 1;

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const parsePage = (raw) => {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PAGE;
};

const parseLimit = (raw) => {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
};

const parseIncludeUnrated = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: true, value: false };
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return { ok: true, value: true };
  if (normalized === 'false' || normalized === '0') return { ok: true, value: false };
  return {
    ok: false,
    message: `${fieldLabel('include_unrated')} must be true or false.`,
  };
};

const escapeRegex = (value) => new RegExp(sanitizeInput(String(value).trim()), 'i');

const buildKeywordFilter = async (searchTerm) => {
  const trimmed = String(searchTerm ?? '').trim();
  if (!trimmed) return {};

  const regex = escapeRegex(trimmed);
  const matchingCustomers = await User.find({
    deleted_at: null,
    $or: [{ name: regex }, { phone_number: regex }, { email: regex }, { user_id: regex }],
  })
    .select('_id')
    .lean();

  const customerIds = matchingCustomers.map((user) => user._id);
  const or = [{ order_unique_id: regex }, { user_unique_id: regex }];
  if (customerIds.length > 0) {
    or.push({ user_id: { $in: customerIds } });
  }
  return { $or: or };
};

const isPopulatedDoc = (value) =>
  Boolean(value) && typeof value === 'object' && value._id && !(value instanceof mongoose.Types.ObjectId);

const mapRatingRow = (line) => {
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
    service_name: service?.name ?? null,
    rating: Number.isFinite(ratingValue) && ratingValue > 0 ? ratingValue : 0,
    review_text: line.review_text || '',
    reviewed_at: line.reviewed_at || null,
  };
};

/**
 * Admin list of per-order ratings for a partner.
 * Each order is assumed to have a single service line; source is order_services.
 */
const getPartnerOrderRatingsForAdmin = async (partnerIdRaw, query = {}) => {
  try {
    const partnerKey = String(partnerIdRaw ?? '').trim();
    if (!partnerKey || !mongoose.Types.ObjectId.isValid(partnerKey)) {
      return fail(400, `${fieldLabel('partnerId')} must be a valid ObjectId.`);
    }

    const includeUnratedResult = parseIncludeUnrated(query.include_unrated);
    if (!includeUnratedResult.ok) {
      return fail(400, includeUnratedResult.message);
    }

    const partner = await User.findOne({
      _id: partnerKey,
      type: USER_TYPE_PARTNER,
      deleted_at: null,
    })
      .select('name average_rating rating_count')
      .lean();

    if (!partner) {
      return fail(404, 'Partner not found.');
    }

    const page = parsePage(query.page);
    const limit = parseLimit(query.limit);
    const keywordFilter = await buildKeywordFilter(query.keyword ?? query.search);

    const filter = {
      partner_id: partner._id,
      deleted_at: null,
      ...(includeUnratedResult.value ? {} : { rating: { $gt: 0 } }),
      ...keywordFilter,
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
        { path: 'service_id', select: 'name' },
      ]
    );

    return ok(200, {
      message: 'Partner ratings fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      limit,
      record: {
        partner_id: partner._id,
        partner_name: partner.name ?? null,
        ...mapRatingSummary(partner),
      },
      records: (data || []).map(mapRatingRow),
    });
  } catch (err) {
    console.error('getPartnerOrderRatingsForAdmin', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  getPartnerOrderRatingsForAdmin,
};
