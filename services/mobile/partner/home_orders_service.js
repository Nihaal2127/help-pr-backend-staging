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
const {
  PARTNER_WORK_STATUS_PENDING,
  PARTNER_WORK_STATUS_IN_PROGRESS,
  buildPartnerWorkStatusQueryFilter,
} = require('../../../enum/partner_work_status_enum');

const HOME_ORDERS_PER_STATUS_LIMIT = 10;

const IN_PROGRESS_SCHEDULE_PRIORITY = {
  TODAY: 0,
  FUTURE: 1,
  PAST: 2,
  UNDATED: 3,
};

const HOME_ORDER_POPULATE = [
  {
    path: 'user_id',
    select: 'name user_id email phone_number profile_url type average_rating rating_count',
  },
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
  const user = hydrateUserRef(formatted.user_id);
  const category = hydrateCategoryRef(formatted.category_id);
  const service = hydrateServiceRef(formatted.service_id);
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
    partner_payment_status: formatted.partner_payment_status ?? 'unpaid',
    is_paid: Boolean(formatted.is_paid),
    user_id: user,
    category_id: category,
    service_id: service,
    franchise_id: franchise,
    user_name: user?.name ?? null,
    user_profile_url: user?.profile_url ?? null,
    category_name: category?.name ?? null,
    service_name: service?.name ?? null,
    created_at: formatted.created_at,
    updated_at: formatted.updated_at,
  };
};

const listCompletedHomeOrders = async (partnerId) => {
  const statusFilter = buildOrderManagementStatusQueryFilter(ORDER_STATUS_COMPLETED);
  if (!statusFilter) {
    return [];
  }

  const partnerOid = new mongoose.Types.ObjectId(String(partnerId));

  const rows = await Order.find({
    partner_id: partnerOid,
    deleted_at: null,
    ...statusFilter,
  })
    .sort({ updated_at: -1, created_at: -1 })
    .limit(HOME_ORDERS_PER_STATUS_LIMIT)
    .populate(HOME_ORDER_POPULATE)
    .lean();

  return rows.map(mapMobileHomeOrder);
};

const buildPendingPartnerWorkStatusQueryFilter = () => ({
  $or: [
    { partner_work_status: PARTNER_WORK_STATUS_PENDING },
    { partner_work_status: { $exists: false } },
    { partner_work_status: null },
  ],
});

const listInProgressHomeOrdersByWorkStatus = async (partnerId, partnerWorkStatusFilter) => {
  const statusFilter = buildOrderManagementStatusQueryFilter(ORDER_STATUS_IN_PROGRESS);
  if (!statusFilter) {
    return [];
  }

  const partnerOid = new mongoose.Types.ObjectId(String(partnerId));
  const todayStart = startOfUtcDay(new Date());
  const todayEnd = endOfUtcDay(new Date());

  const rows = await Order.find({
    partner_id: partnerOid,
    deleted_at: null,
    ...statusFilter,
    ...partnerWorkStatusFilter,
  })
    .populate(HOME_ORDER_POPULATE)
    .lean();

  const sorted = rows
    .sort((left, right) => compareInProgressHomeOrders(left, right, todayStart, todayEnd))
    .slice(0, HOME_ORDERS_PER_STATUS_LIMIT);

  return sorted.map(mapMobileHomeOrder);
};

const listLiveHomeOrders = async (partnerId) =>
  listInProgressHomeOrdersByWorkStatus(
    partnerId,
    buildPartnerWorkStatusQueryFilter(PARTNER_WORK_STATUS_IN_PROGRESS)
  );

const listInProgressHomeOrders = async (partnerId) =>
  listInProgressHomeOrdersByWorkStatus(partnerId, buildPendingPartnerWorkStatusQueryFilter());

const loadPartnerHomeOrders = async (partnerId) => {
  const [live, in_progress, completed] = await Promise.all([
    listLiveHomeOrders(partnerId),
    listInProgressHomeOrders(partnerId),
    listCompletedHomeOrders(partnerId),
  ]);

  return { live, in_progress, completed };
};

module.exports = {
  loadPartnerHomeOrders,
  HOME_ORDERS_PER_STATUS_LIMIT,
};
