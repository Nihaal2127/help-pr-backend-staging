const mongoose = require('mongoose');
const Order = require('../../../models/order');
const { formatOrderForApi } = require('../../../utils/order_api_format');
const { stripAdminDescriptionForPublicApi } = require('../../../utils/admin_description_access');
const { startOfUtcDay, endOfUtcDay } = require('../../../utils/date_bounds');
const {
  hydrateUserRef,
  hydrateCategoryRef,
  hydrateServiceRef,
  hydrateFranchiseRef,
} = require('../../../utils/list_aggregation');
const {
  ORDER_STATUS_IN_PROGRESS,
  ORDER_STATUS_COMPLETED,
  buildOrderManagementStatusQueryFilter,
} = require('../../../enum/order_status_enum');

const HOME_ORDERS_PER_STATUS_LIMIT = 10;

/** 0 = schedule overlaps today, 1 = future, 2 = past, 3 = no usable schedule dates */
const IN_PROGRESS_SCHEDULE_PRIORITY = {
  TODAY: 0,
  FUTURE: 1,
  PAST: 2,
  UNDATED: 3,
};

const HOME_ORDER_POPULATE = [
  {
    path: 'category_id',
    select:
      'name category_id desc image_url approval_status is_request is_active rejection_reason',
  },
  {
    path: 'service_id',
    select:
      'name service_id desc image_url approval_status is_request is_active rejection_reason payment_type',
  },
  {
    path: 'partner_id',
    select: 'name user_id email phone_number profile_url type average_rating rating_count',
  },
  { path: 'franchise_id', select: 'name city_name state_name' },
];

const scheduleOverlapsRange = (order, rangeFrom, rangeTo) => {
  const from = order.from_date ? new Date(order.from_date) : null;
  const to = order.to_date ? new Date(order.to_date) : null;
  const orderDate = order.order_date ? new Date(order.order_date) : null;

  if (from && to && from <= rangeTo && to >= rangeFrom) return true;
  if (from && !to && from >= rangeFrom && from <= rangeTo) return true;
  if (to && !from && to >= rangeFrom && to <= rangeTo) return true;
  if (orderDate && orderDate >= rangeFrom && orderDate <= rangeTo) return true;
  return false;
};

const getInProgressScheduleSortMeta = (order, todayStart, todayEnd) => {
  const from = order.from_date ? new Date(order.from_date) : null;
  const to = order.to_date ? new Date(order.to_date) : null;
  const orderDate = order.order_date ? new Date(order.order_date) : null;
  const rangeStart = from || orderDate || to;
  const rangeEnd = to || from || orderDate;

  if (!rangeStart && !rangeEnd) {
    return {
      priority: IN_PROGRESS_SCHEDULE_PRIORITY.UNDATED,
      sortDate: null,
    };
  }

  if (scheduleOverlapsRange(order, todayStart, todayEnd)) {
    return {
      priority: IN_PROGRESS_SCHEDULE_PRIORITY.TODAY,
      sortDate: rangeStart,
    };
  }

  if (rangeStart > todayEnd) {
    return {
      priority: IN_PROGRESS_SCHEDULE_PRIORITY.FUTURE,
      sortDate: rangeStart,
    };
  }

  if (rangeEnd < todayStart) {
    return {
      priority: IN_PROGRESS_SCHEDULE_PRIORITY.PAST,
      sortDate: rangeEnd,
    };
  }

  return {
    priority: IN_PROGRESS_SCHEDULE_PRIORITY.UNDATED,
    sortDate: rangeStart,
  };
};

const compareInProgressHomeOrders = (left, right, todayStart, todayEnd) => {
  const leftMeta = getInProgressScheduleSortMeta(left, todayStart, todayEnd);
  const rightMeta = getInProgressScheduleSortMeta(right, todayStart, todayEnd);

  if (leftMeta.priority !== rightMeta.priority) {
    return leftMeta.priority - rightMeta.priority;
  }

  const leftTime = leftMeta.sortDate?.getTime() ?? 0;
  const rightTime = rightMeta.sortDate?.getTime() ?? 0;

  if (leftMeta.priority === IN_PROGRESS_SCHEDULE_PRIORITY.PAST) {
    if (rightTime !== leftTime) return rightTime - leftTime;
  } else if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return (right.updated_at?.getTime() ?? 0) - (left.updated_at?.getTime() ?? 0);
};

const mapMobileHomeOrder = (order) => {
  const formatted = stripAdminDescriptionForPublicApi(formatOrderForApi(order));
  const category = hydrateCategoryRef(formatted.category_id);
  const service = hydrateServiceRef(formatted.service_id);
  const partner = hydrateUserRef(formatted.partner_id);
  const franchise = hydrateFranchiseRef(formatted.franchise_id);

  return {
    _id: formatted._id,
    unique_id: formatted.unique_id ?? '',
    order_status: formatted.order_status,
    partner_work_status: formatted.partner_work_status ?? 'pending',
    order_date: formatted.order_date ?? null,
    from_date: formatted.from_date ?? null,
    to_date: formatted.to_date ?? null,
    address: formatted.address ?? '',
    total_price: formatted.total_price,
    user_payment_status: formatted.user_payment_status ?? formatted.payment_status ?? 'unpaid',
    is_paid: Boolean(formatted.is_paid),
    category_id: category,
    service_id: service,
    partner_id: partner,
    franchise_id: franchise,
    category_name: category?.name ?? null,
    service_name: service?.name ?? null,
    partner_name: partner?.name ?? null,
    partner_profile_url: partner?.profile_url ?? null,
    created_at: formatted.created_at,
    updated_at: formatted.updated_at,
  };
};

const listCompletedHomeOrders = async (userId) => {
  const statusFilter = buildOrderManagementStatusQueryFilter(ORDER_STATUS_COMPLETED);
  if (!statusFilter) {
    return [];
  }

  const userOid = new mongoose.Types.ObjectId(String(userId));

  const rows = await Order.find({
    user_id: userOid,
    deleted_at: null,
    ...statusFilter,
  })
    .sort({ updated_at: -1, created_at: -1 })
    .limit(HOME_ORDERS_PER_STATUS_LIMIT)
    .populate(HOME_ORDER_POPULATE)
    .lean();

  return rows.map(mapMobileHomeOrder);
};

const listInProgressHomeOrders = async (userId) => {
  const statusFilter = buildOrderManagementStatusQueryFilter(ORDER_STATUS_IN_PROGRESS);
  if (!statusFilter) {
    return [];
  }

  const userOid = new mongoose.Types.ObjectId(String(userId));
  const todayStart = startOfUtcDay(new Date());
  const todayEnd = endOfUtcDay(new Date());

  const rows = await Order.find({
    user_id: userOid,
    deleted_at: null,
    ...statusFilter,
  })
    .populate(HOME_ORDER_POPULATE)
    .lean();

  const sorted = rows
    .sort((left, right) => compareInProgressHomeOrders(left, right, todayStart, todayEnd))
    .slice(0, HOME_ORDERS_PER_STATUS_LIMIT);

  return sorted.map(mapMobileHomeOrder);
};

const loadCustomerHomeOrders = async (userId) => {
  const [in_progress, completed] = await Promise.all([
    listInProgressHomeOrders(userId),
    listCompletedHomeOrders(userId),
  ]);

  return { in_progress, completed };
};

module.exports = {
  loadCustomerHomeOrders,
  HOME_ORDERS_PER_STATUS_LIMIT,
};
