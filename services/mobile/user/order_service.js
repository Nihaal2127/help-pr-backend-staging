const mongoose = require('mongoose');
const Order = require('../../../models/order');
const { formatOrderRecords } = require('../../../utils/order_api_format');
const { escapeRegExp } = require('../../../utils/string_helpers');
const {
  buildOrderDateRangeFilter,
  buildOrderTodayOverlapFilter,
} = require('../../../utils/schedule_date_filters');
const { isValidOrderPaymentStatus } = require('../../../enum/order_payment_status_enum');
const {
  ORDER_STATUSES,
  buildOrderManagementStatusQueryFilter,
} = require('../../../enum/order_status_enum');
const { loadOrderDetailLean } = require('../../order_detail_service');

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

const listCustomerOrders = async (customerId, query = {}) => {
  try {
    if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) {
      return fail(401, 'Invalid token.');
    }

    const page = parsePositiveInt(query.page, 1);
    const limit = Math.min(parsePositiveInt(query.limit, 10), 50);
    const skip = (page - 1) * limit;

    const filter = {
      deleted_at: null,
      user_id: new mongoose.Types.ObjectId(String(customerId)),
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
    if (searchRaw !== undefined && String(searchRaw).trim() !== '') {
      const search = String(searchRaw).trim();
      const regex = new RegExp(escapeRegExp(search), 'i');
      filter.$or = [
        { unique_id: regex },
        { address: regex },
        { order_description: regex },
        { customer_description: regex },
        { transaction_id: regex },
      ];
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

    if (paymentStatusRaw) {
      if (!isValidOrderPaymentStatus(paymentStatusRaw)) {
        return fail(
          409,
          'Invalid user_payment_status/payment_status filter. Use unpaid, paid, partially_paid, refund, partially_refund.'
        );
      }
      filter.user_payment_status = paymentStatusRaw;
    }

    const objectIdFilterKeys = [
      'franchise_id',
      'partner_id',
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

    const [rows, totalItems, todayCount] = await Promise.all([
      Order.find(filter)
        .sort({ updated_at: -1, created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
      Order.countDocuments(todayCountFilter),
    ]);

    const totalPages = Math.max(Math.ceil(totalItems / limit), 1);

    return ok(200, {
      message: 'Orders fetched successfully.',
      data: {
        totalItems,
        todayCount,
        totalPages,
        currentPage: page,
        limit,
        records: formatOrderRecords(rows),
      },
    });
  } catch (err) {
    console.error('mobile user list orders', err.message);
    return fail(500, 'Internal server error.');
  }
};

const getCustomerOrderById = async (customerId, orderId) => {
  try {
    if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) {
      return fail(401, 'Invalid token.');
    }
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return fail(400, 'Invalid order id.');
    }

    const order = await Order.findOne({
      _id: orderId,
      user_id: new mongoose.Types.ObjectId(String(customerId)),
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
      record,
    });
  } catch (err) {
    console.error('mobile user get order details', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listCustomerOrders,
  getCustomerOrderById,
};
