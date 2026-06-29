const mongoose = require('mongoose');
const Order = require('../../../models/order');
const OrderService = require('../../../models/order_services');
const User = require('../../../models/user');
const Service = require('../../../models/service');
const Category = require('../../../models/category');
const City = require('../../../models/city');
const State = require('../../../models/state');
const Address = require('../../../models/address');
const Franchise = require('../../../models/franchise');
const Quote = require('../../../models/quote');
const { formatOrderRecords } = require('../../../utils/order_api_format');
const { stripAdminDescriptionForPublicApi } = require('../../../utils/admin_description_access');
const { escapeRegExp } = require('../../../utils/string_helpers');
const {
  buildOrderDateRangeFilter,
  buildOrderTodayOverlapFilter,
} = require('../../../utils/schedule_date_filters');
const {
  isValidOrderPaymentStatus,
  isValidPartnerPaymentStatus,
} = require('../../../enum/order_payment_status_enum');
const {
  ORDER_STATUSES,
  buildOrderManagementStatusQueryFilter,
} = require('../../../enum/order_status_enum');
const {
  buildPartnerWorkStatusQueryFilter,
} = require('../../../enum/partner_work_status_enum');
const { attachPartnerRatingFields } = require('../../../utils/rating_format');
const {
  buildEntityListPipeline,
  parseFacetListResult,
  getListCollectionNames,
} = require('../../../utils/list_aggregation');
const { attachRefundsToOrderRecords } = require('../../refund_service');
const {
  fail,
  parsePositiveInt,
  parseOptionalBoolean,
  mergeMongoFilters,
} = require('../../../utils/mobile_service_result');

const addObjectIdFilter = (query, key, filter) => {
  const raw = query[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: true };
  }
  if (!mongoose.Types.ObjectId.isValid(String(raw))) {
    return { ok: false, message: `Invalid ${key} filter.` };
  }
  filter[key] = new mongoose.Types.ObjectId(String(raw));
  return { ok: true };
};

const attachPartnerRatingsToOrderRecord = (record) => {
  if (!record?.partner_id?._id) return record;
  return {
    ...record,
    partner_id: {
      ...record.partner_id,
      ...attachPartnerRatingFields(record.partner_id),
    },
  };
};

const EMPTY_CUSTOMER_REVIEW = { rating: null, review_text: null, reviewed_at: null };

const pickCustomerReviewForOrder = (serviceLines, orderRecord, { partnerId } = {}) => {
  if (!serviceLines?.length) {
    return EMPTY_CUSTOMER_REVIEW;
  }

  const resolvedPartnerId =
    partnerId ?? orderRecord?.partner_id?._id ?? orderRecord?.partner_id ?? null;
  const resolvedServiceId = orderRecord?.service_id?._id ?? orderRecord?.service_id ?? null;

  let line = null;
  if (resolvedServiceId && resolvedPartnerId) {
    line = serviceLines.find(
      (row) =>
        String(row.service_id) === String(resolvedServiceId) &&
        String(row.partner_id) === String(resolvedPartnerId)
    );
  }
  if (!line && resolvedPartnerId) {
    line = serviceLines.find((row) => String(row.partner_id) === String(resolvedPartnerId));
  }
  if (!line) {
    line = serviceLines[0];
  }

  const rating = Number(line?.rating) || 0;
  if (rating <= 0) {
    return EMPTY_CUSTOMER_REVIEW;
  }

  return {
    rating,
    review_text: line.review_text || '',
    reviewed_at: line.reviewed_at || null,
  };
};

const attachCustomerReviewsToOrderRecords = async (records, { partnerId } = {}) => {
  if (!Array.isArray(records) || !records.length) {
    return records;
  }

  const orderIds = records.map((record) => record._id).filter((id) => id != null);
  if (!orderIds.length) {
    return records;
  }

  const serviceLines = await OrderService.find({
    order_id: { $in: orderIds },
    deleted_at: null,
  })
    .select('order_id service_id partner_id rating review_text reviewed_at')
    .lean();

  const serviceLinesByOrderId = new Map();
  for (const line of serviceLines) {
    const key = String(line.order_id);
    if (!serviceLinesByOrderId.has(key)) {
      serviceLinesByOrderId.set(key, []);
    }
    serviceLinesByOrderId.get(key).push(line);
  }

  return records.map((record) => {
    const lines = serviceLinesByOrderId.get(String(record._id)) || [];
    return {
      ...record,
      ...pickCustomerReviewForOrder(lines, record, { partnerId }),
    };
  });
};

const buildOrderListSearchRegex = (query) => {
  const searchRaw = query.search ?? query.q;
  if (searchRaw === undefined || String(searchRaw).trim() === '') {
    return null;
  }
  const search = String(searchRaw).trim();
  return new RegExp(escapeRegExp(search), 'i');
};

const applyOrderManagementStatusFilter = (filter, query) => {
  const statusRaw = query.status;
  if (statusRaw === undefined || String(statusRaw).trim() === '') {
    return { ok: true };
  }

  const statusFilter = buildOrderManagementStatusQueryFilter(statusRaw);
  if (!statusFilter) {
    return fail(409, `Invalid status. Use one of: ${ORDER_STATUSES.join(', ')}.`);
  }
  Object.assign(filter, statusFilter);
  return { ok: true };
};

const applyOrderDateAndPaidFilters = (filter, query) => {
  const dateRangeResult = buildOrderDateRangeFilter(query);
  if (!dateRangeResult.ok) {
    return fail(409, dateRangeResult.message);
  }
  Object.assign(filter, dateRangeResult.filter);

  const isPaidResult = parseOptionalBoolean(query.is_paid);
  if (!isPaidResult.ok) {
    return fail(409, isPaidResult.message);
  }
  if (isPaidResult.value !== null) {
    filter.is_paid = isPaidResult.value;
  }

  return { ok: true };
};

const applyUserPaymentStatusFilter = (filter, query) => {
  const paymentStatusRaw =
    query.user_payment_status !== undefined &&
    query.user_payment_status !== null &&
    String(query.user_payment_status).trim() !== ''
      ? String(query.user_payment_status).trim().toLowerCase()
      : query.payment_status !== undefined &&
          query.payment_status !== null &&
          String(query.payment_status).trim() !== ''
        ? String(query.payment_status).trim().toLowerCase()
        : null;

  if (!paymentStatusRaw) {
    return { ok: true };
  }

  if (!isValidOrderPaymentStatus(paymentStatusRaw)) {
    return fail(
      409,
      'Invalid user_payment_status/payment_status filter. Use unpaid, paid, partially_paid, refund, partially_refund.'
    );
  }
  filter.user_payment_status = paymentStatusRaw;
  return { ok: true };
};

const applyPartnerPaymentStatusFilter = (filter, query) => {
  const partnerPaymentStatusRaw =
    query.partner_payment_status !== undefined &&
    query.partner_payment_status !== null &&
    String(query.partner_payment_status).trim() !== ''
      ? String(query.partner_payment_status).trim().toLowerCase()
      : null;

  if (!partnerPaymentStatusRaw) {
    return { ok: true };
  }

  if (!isValidPartnerPaymentStatus(partnerPaymentStatusRaw)) {
    return fail(
      409,
      'Invalid partner_payment_status filter. Use unpaid, partially_paid, paid.'
    );
  }
  filter.partner_payment_status = partnerPaymentStatusRaw;
  return { ok: true };
};

const applyPartnerWorkStatusFilter = (filter, query) => {
  const partnerWorkStatusRaw =
    query.partner_work_status !== undefined &&
    query.partner_work_status !== null &&
    String(query.partner_work_status).trim() !== ''
      ? String(query.partner_work_status).trim().toLowerCase()
      : null;

  if (!partnerWorkStatusRaw) {
    return { ok: true };
  }

  const workStatusFilter = buildPartnerWorkStatusQueryFilter(partnerWorkStatusRaw);
  if (!workStatusFilter) {
    return fail(
      409,
      'Invalid partner_work_status filter. Use pending, in-progress, or completed.'
    );
  }
  Object.assign(filter, workStatusFilter);
  return { ok: true };
};

const applyObjectIdFilters = (filter, query, keys) => {
  for (const key of keys) {
    const result = addObjectIdFilter(query, key, filter);
    if (!result.ok) {
      return fail(409, result.message);
    }
  }
  return { ok: true };
};

const ORDER_LIST_PIPELINE_ADD_FIELDS = {
  city_id: {
    $cond: [
      { $ifNull: ['$_city._id', false] },
      { _id: '$_city._id', name: '$_city.name' },
      null,
    ],
  },
  quote_id: {
    $cond: [
      { $ifNull: ['$_quote._id', false] },
      {
        _id: '$_quote._id',
        quote_sequence_id: '$_quote.quote_sequence_id',
        quote_description: '$_quote.quote_description',
        status: '$_quote.status',
      },
      null,
    ],
  },
};

const fetchPaginatedMobileOrderList = async ({
  filter,
  searchRegex,
  skip,
  limit,
  page,
  searchFields,
  includeCustomerReviews = false,
  reviewPartnerId = null,
}) => {
  const todayOverlapResult = buildOrderTodayOverlapFilter();
  const todayCountFilter = mergeMongoFilters(filter, todayOverlapResult.filter);

  const collections = getListCollectionNames({
    users: User,
    categories: Category,
    services: Service,
    cities: City,
    franchise: Franchise,
    quotes: Quote,
    address: Address,
    states: State,
  });

  const pipeline = buildEntityListPipeline({
    baseFilter: filter,
    sortStage: { updated_at: -1, created_at: -1 },
    skip,
    limit,
    regex: searchRegex,
    searchFields,
    collections,
    includeRootCityLookup: true,
    includeQuoteLookup: true,
    includeServiceItemsLookup: false,
    extraAddFields: ORDER_LIST_PIPELINE_ADD_FIELDS,
    extraProject: { service_items: 0 },
  });

  const [aggResult, todayCount] = await Promise.all([
    Order.aggregate(pipeline).collation({ locale: 'en', strength: 2 }).exec(),
    Order.countDocuments(todayCountFilter),
  ]);

  const { data: rows, totalCount: totalItems } = parseFacetListResult(aggResult, limit);
  const totalPages = Math.max(Math.ceil(totalItems / limit), 1);
  let records = await attachRefundsToOrderRecords(
    formatOrderRecords(rows)
      .map(attachPartnerRatingsToOrderRecord)
      .map(stripAdminDescriptionForPublicApi)
  );

  if (includeCustomerReviews) {
    records = await attachCustomerReviewsToOrderRecords(records, {
      partnerId: reviewPartnerId,
    });
  }

  return {
    totalItems,
    todayCount,
    totalPages,
    currentPage: page,
    limit,
    records,
  };
};

const parseMobileOrderListPagination = (query) => {
  const page = parsePositiveInt(query.page, 1);
  const limit = Math.min(parsePositiveInt(query.limit, 10), 50);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

module.exports = {
  addObjectIdFilter,
  attachPartnerRatingsToOrderRecord,
  attachCustomerReviewsToOrderRecords,
  pickCustomerReviewForOrder,
  buildOrderListSearchRegex,
  applyOrderManagementStatusFilter,
  applyOrderDateAndPaidFilters,
  applyUserPaymentStatusFilter,
  applyPartnerPaymentStatusFilter,
  applyPartnerWorkStatusFilter,
  applyObjectIdFilters,
  fetchPaginatedMobileOrderList,
  parseMobileOrderListPagination,
};
