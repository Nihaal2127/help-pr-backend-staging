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
const { loadOrderDetailLean } = require('../../order_detail_service');
const { attachPartnerRatingFields } = require('../../../utils/rating_format');
const {
  buildEntityListPipeline,
  parseFacetListResult,
  getListCollectionNames,
  embedOrderDetailForeignKeys,
} = require('../../../utils/list_aggregation');
const { attachRefundsToOrderRecords } = require('../../refund_service');

const MOBILE_PARTNER_ORDER_LIST_SEARCH_FIELDS = [
  'unique_id',
  'user_unique_id',
  'address',
  'comments',
  'transaction_id',
  'payment_mode_id',
  'discount_code',
  'customer_description',
  'order_description',
  '_quote.quote_sequence_id',
  '_quote.quote_description',
  '_user.name',
  '_user.user_id',
  '_user.email',
  '_user.phone_number',
  '_employee.name',
  '_employee.user_id',
  '_created_by.name',
  '_created_by.user_id',
  '_category.name',
  '_category.category_id',
  '_service.name',
  '_service.service_id',
  '_city.name',
  '_franchise.name',
];

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const parsePositiveInt = (raw, fallback) => {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseOptionalBoolean = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: true, value: null };
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true') return { ok: true, value: true };
  if (normalized === 'false') return { ok: true, value: false };
  return { ok: false, message: 'Invalid is_paid filter. Use true or false.' };
};

const mergeMongoFilters = (...parts) => {
  const filters = parts.filter((part) => part && Object.keys(part).length > 0);
  if (filters.length === 0) return {};
  if (filters.length === 1) return filters[0];
  return { $and: filters };
};

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

const listPartnerOrders = async (partnerId, query = {}) => {
  try {
    if (!partnerId || !mongoose.Types.ObjectId.isValid(String(partnerId))) {
      return fail(401, 'Invalid token.');
    }

    const page = parsePositiveInt(query.page, 1);
    const limit = Math.min(parsePositiveInt(query.limit, 10), 50);
    const skip = (page - 1) * limit;

    const filter = {
      deleted_at: null,
      partner_id: new mongoose.Types.ObjectId(String(partnerId)),
    };

    const statusRaw = query.status;
    if (statusRaw !== undefined && String(statusRaw).trim() !== '') {
      const statusFilter = buildOrderManagementStatusQueryFilter(statusRaw);
      if (!statusFilter) {
        return fail(409, `Invalid status. Use one of: ${ORDER_STATUSES.join(', ')}.`);
      }
      Object.assign(filter, statusFilter);
    }

    const searchRaw = query.search ?? query.q;
    let searchRegex = null;
    if (searchRaw !== undefined && String(searchRaw).trim() !== '') {
      const search = String(searchRaw).trim();
      searchRegex = new RegExp(escapeRegExp(search), 'i');
    }

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

    const userPaymentStatusRaw =
      query.user_payment_status !== undefined &&
      query.user_payment_status !== null &&
      String(query.user_payment_status).trim() !== ''
        ? String(query.user_payment_status).trim().toLowerCase()
        : query.payment_status !== undefined &&
            query.payment_status !== null &&
            String(query.payment_status).trim() !== ''
          ? String(query.payment_status).trim().toLowerCase()
          : null;

    if (userPaymentStatusRaw) {
      if (!isValidOrderPaymentStatus(userPaymentStatusRaw)) {
        return fail(
          409,
          'Invalid user_payment_status/payment_status filter. Use unpaid, paid, partially_paid, refund, partially_refund.'
        );
      }
      filter.user_payment_status = userPaymentStatusRaw;
    }

    const partnerPaymentStatusRaw =
      query.partner_payment_status !== undefined &&
      query.partner_payment_status !== null &&
      String(query.partner_payment_status).trim() !== ''
        ? String(query.partner_payment_status).trim().toLowerCase()
        : null;

    if (partnerPaymentStatusRaw) {
      if (!isValidPartnerPaymentStatus(partnerPaymentStatusRaw)) {
        return fail(
          409,
          'Invalid partner_payment_status filter. Use unpaid, partially_paid, paid.'
        );
      }
      filter.partner_payment_status = partnerPaymentStatusRaw;
    }

    const partnerWorkStatusRaw =
      query.partner_work_status !== undefined &&
      query.partner_work_status !== null &&
      String(query.partner_work_status).trim() !== ''
        ? String(query.partner_work_status).trim().toLowerCase()
        : null;

    if (partnerWorkStatusRaw) {
      const workStatusFilter = buildPartnerWorkStatusQueryFilter(partnerWorkStatusRaw);
      if (!workStatusFilter) {
        return fail(
          409,
          'Invalid partner_work_status filter. Use pending, in-progress, or completed.'
        );
      }
      Object.assign(filter, workStatusFilter);
    }

    const objectIdFilterKeys = [
      'franchise_id',
      'user_id',
      'category_id',
      'service_id',
      'city_id',
      'address_id',
    ];
    for (const key of objectIdFilterKeys) {
      const result = addObjectIdFilter(query, key, filter);
      if (!result.ok) {
        return fail(409, result.message);
      }
    }

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
      searchFields: MOBILE_PARTNER_ORDER_LIST_SEARCH_FIELDS,
      collections,
      includeRootCityLookup: true,
      includeQuoteLookup: true,
      includeServiceItemsLookup: false,
      extraAddFields: {
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
      },
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

    return ok(200, {
      message: 'Orders fetched successfully.',
      data: {
        totalItems,
        todayCount,
        totalPages,
        currentPage: page,
        limit,
        records,
      },
    });
  } catch (err) {
    console.error('mobile partner list orders', err.message);
    return fail(500, 'Internal server error.');
  }
};

const getPartnerOrderById = async (partnerId, orderId) => {
  try {
    if (!partnerId || !mongoose.Types.ObjectId.isValid(String(partnerId))) {
      return fail(401, 'Invalid token.');
    }
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return fail(400, 'Invalid order id.');
    }

    const order = await Order.findOne({
      _id: orderId,
      partner_id: new mongoose.Types.ObjectId(String(partnerId)),
      deleted_at: null,
    });

    if (!order) {
      return fail(404, 'Order not found.');
    }

    const record = await loadOrderDetailLean(order._id);
    if (!record) {
      return fail(404, 'Order not found.');
    }

    return ok(200, {
      message: 'Order details fetched successfully.',
      record: embedOrderDetailForeignKeys(record),
    });
  } catch (err) {
    console.error('mobile partner get order details', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listPartnerOrders,
  getPartnerOrderById,
};
