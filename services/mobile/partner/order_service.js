const mongoose = require('mongoose');
const Order = require('../../../models/order');
const { loadOrderDetailLean } = require('../../order_detail_service');
const { buildOrderInvoiceHtml } = require('../../../utils/order_invoice_html');
const { embedOrderDetailForeignKeys } = require('../../../utils/list_aggregation');
const { stripAdminDescriptionForPublicApi } = require('../../../utils/admin_description_access');
const { attachPartnerOrderSummary } = require('../../../utils/partner_order_summary');
const { fail, ok } = require('../../../utils/mobile_service_result');
const { assertValidCallerObjectId } = require('../shared/order_access_helpers');
const {
  buildOrderListSearchRegex,
  applyOrderManagementStatusFilter,
  applyOrderDateAndPaidFilters,
  applyUserPaymentStatusFilter,
  applyPartnerPaymentStatusFilter,
  applyPartnerWorkStatusFilter,
  applyObjectIdFilters,
  fetchPaginatedMobileOrderList,
  parseMobileOrderListPagination,
} = require('../shared/order_list_helpers');

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

const PARTNER_OBJECT_ID_FILTER_KEYS = [
  'franchise_id',
  'user_id',
  'category_id',
  'service_id',
  'city_id',
  'address_id',
];

const listPartnerOrders = async (partnerId, query = {}) => {
  try {
    const callerResult = assertValidCallerObjectId(partnerId);
    if (!callerResult.ok) {
      return callerResult;
    }

    const { page, limit, skip } = parseMobileOrderListPagination(query);

    const filter = {
      deleted_at: null,
      partner_id: callerResult.oid,
    };

    const statusResult = applyOrderManagementStatusFilter(filter, query);
    if (!statusResult.ok) {
      return statusResult;
    }

    const searchRegex = buildOrderListSearchRegex(query);

    const datePaidResult = applyOrderDateAndPaidFilters(filter, query);
    if (!datePaidResult.ok) {
      return datePaidResult;
    }

    const paymentResult = applyUserPaymentStatusFilter(filter, query);
    if (!paymentResult.ok) {
      return paymentResult;
    }

    const partnerPaymentResult = applyPartnerPaymentStatusFilter(filter, query);
    if (!partnerPaymentResult.ok) {
      return partnerPaymentResult;
    }

    const workStatusResult = applyPartnerWorkStatusFilter(filter, query);
    if (!workStatusResult.ok) {
      return workStatusResult;
    }

    const objectIdResult = applyObjectIdFilters(filter, query, PARTNER_OBJECT_ID_FILTER_KEYS);
    if (!objectIdResult.ok) {
      return objectIdResult;
    }

    const listData = await fetchPaginatedMobileOrderList({
      filter,
      searchRegex,
      skip,
      limit,
      page,
      searchFields: MOBILE_PARTNER_ORDER_LIST_SEARCH_FIELDS,
      includeCustomerReviews: true,
      reviewPartnerId: callerResult.oid,
    });

    return ok(200, {
      message: 'Orders fetched successfully.',
      data: listData,
    });
  } catch (err) {
    console.error('mobile partner list orders', err.message);
    return fail(500, 'Internal server error.');
  }
};

const getPartnerOrderById = async (partnerId, orderId) => {
  try {
    const callerResult = assertValidCallerObjectId(partnerId);
    if (!callerResult.ok) {
      return callerResult;
    }
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return fail(400, 'Invalid order id.');
    }

    const order = await Order.findOne({
      _id: orderId,
      partner_id: callerResult.oid,
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
      record: stripAdminDescriptionForPublicApi(
        attachPartnerOrderSummary(embedOrderDetailForeignKeys(record))
      ),
    });
  } catch (err) {
    console.error('mobile partner get order details', err.message);
    return fail(500, 'Internal server error.');
  }
};

const getPartnerOrderInvoice = async (partnerId, orderId) => {
  try {
    const callerResult = assertValidCallerObjectId(partnerId);
    if (!callerResult.ok) {
      return callerResult;
    }
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return fail(400, 'Invalid order id.');
    }

    const order = await Order.findOne({
      _id: orderId,
      partner_id: callerResult.oid,
      deleted_at: null,
    });

    if (!order) {
      return fail(404, 'Order not found.');
    }

    const record = await loadOrderDetailLean(order._id);
    if (!record) {
      return fail(404, 'Order not found.');
    }

    const html = buildOrderInvoiceHtml(record, { audience: 'partner' });
    const safeId = String(record.unique_id || order._id).replace(/[^\w-]/g, '_');

    return ok(200, {
      html,
      filename: `invoice-${safeId}.html`,
    });
  } catch (err) {
    console.error('mobile partner get order invoice', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listPartnerOrders,
  getPartnerOrderById,
  getPartnerOrderInvoice,
};
