const mongoose = require('mongoose');
const Order = require('../../../models/order');
const User = require('../../../models/user');
const Service = require('../../../models/service');
const Category = require('../../../models/category');
const City = require('../../../models/city');
const State = require('../../../models/state');
const Address = require('../../../models/address');
const Franchise = require('../../../models/franchise');
const Quote = require('../../../models/quote');
const { formatOrderRecords } = require('../../../utils/order_api_format');
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
  const records = await attachRefundsToOrderRecords(
    formatOrderRecords(rows).map(attachPartnerRatingsToOrderRecord)
  );

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
