const mongoose = require('mongoose');
const Order = require('../../../models/order');
const { formatOrderForApi } = require('../../../utils/order_api_format');
const {
  ORDER_STATUS_IN_PROGRESS,
  ORDER_STATUS_COMPLETED,
  buildOrderManagementStatusQueryFilter,
} = require('../../../enum/order_status_enum');

const HOME_ORDERS_PER_STATUS_LIMIT = 20;

const extractRefId = (ref) => {
  if (!ref) return null;
  if (typeof ref === 'object' && ref._id != null) return ref._id;
  return ref;
};

const extractRefName = (ref) => {
  if (!ref) return null;
  if (typeof ref === 'object' && ref.name != null) return ref.name;
  return null;
};

const mapMobileHomeOrder = (order) => {
  const formatted = formatOrderForApi(order);
  const categoryRef = formatted.category_id;
  const serviceRef = formatted.service_id;
  const partnerRef = formatted.partner_id;

  return {
    _id: formatted._id,
    unique_id: formatted.unique_id ?? '',
    order_status: formatted.order_status,
    order_date: formatted.order_date ?? null,
    from_date: formatted.from_date ?? null,
    to_date: formatted.to_date ?? null,
    address: formatted.address ?? '',
    total_price: formatted.total_price,
    user_payment_status: formatted.user_payment_status ?? formatted.payment_status ?? 'unpaid',
    is_paid: Boolean(formatted.is_paid),
    category_id: extractRefId(categoryRef),
    service_id: extractRefId(serviceRef),
    partner_id: extractRefId(partnerRef),
    franchise_id: formatted.franchise_id,
    category_name: extractRefName(categoryRef),
    service_name: extractRefName(serviceRef),
    partner_name: extractRefName(partnerRef),
    partner_profile_url:
      partnerRef && typeof partnerRef === 'object' ? partnerRef.profile_url ?? null : null,
    created_at: formatted.created_at,
    updated_at: formatted.updated_at,
  };
};

const listOrdersForCustomerByStatus = async (userId, status) => {
  const statusFilter = buildOrderManagementStatusQueryFilter(status);
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
    .populate([
      { path: 'category_id', select: 'name' },
      { path: 'service_id', select: 'name' },
      { path: 'partner_id', select: 'name profile_url' },
    ])
    .lean();

  return rows.map(mapMobileHomeOrder);
};

const loadCustomerHomeOrders = async (userId) => {
  const [in_progress, completed] = await Promise.all([
    listOrdersForCustomerByStatus(userId, ORDER_STATUS_IN_PROGRESS),
    listOrdersForCustomerByStatus(userId, ORDER_STATUS_COMPLETED),
  ]);

  return { in_progress, completed };
};

module.exports = {
  loadCustomerHomeOrders,
  HOME_ORDERS_PER_STATUS_LIMIT,
};
