const mongoose = require('mongoose');
const Order = require('../../../models/order');
const { formatOrderRecords } = require('../../../utils/order_api_format');
const {
  ORDER_STATUSES,
  buildOrderManagementStatusQueryFilter,
} = require('../../../enum/order_status_enum');

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const parsePositiveInt = (raw, fallback) => {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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

    const [rows, totalItems] = await Promise.all([
      Order.find(filter)
        .sort({ updated_at: -1, created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    const totalPages = Math.max(Math.ceil(totalItems / limit), 1);

    return ok(200, {
      message: 'Orders fetched successfully.',
      data: {
        totalItems,
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

module.exports = {
  listCustomerOrders,
};
