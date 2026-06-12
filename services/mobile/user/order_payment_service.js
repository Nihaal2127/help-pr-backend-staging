const mongoose = require('mongoose');
const Order = require('../../../models/order');
const OrderPayment = require('../../../models/order_payment');
const { loadCustomerOrder } = require('../shared/order_access_helpers');
const { applyPagination } = require('../../../utils/pagination');
const { buildFieldDateRangeFilter } = require('../../../utils/schedule_date_filters');
const {
  createOrderPaymentRecord,
  updateOrderPaymentRecord,
  softDeleteOrderPaymentRecord,
  formatMobileCustomerOrderSummary,
} = require('../../order_payment_crud_service');

const PAYER_TYPE_CUSTOMER = 'customer';
const { fail, ok, parsePositiveInt } = require('../../../utils/mobile_service_result');

const listAllCustomerOrderPayments = async (customerId, query = {}) => {
  try {
    if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) {
      return fail(401, 'Invalid token.');
    }

    const page = parsePositiveInt(query.page, 1);
    const limit = Math.min(parsePositiveInt(query.limit, 10), 50);
    const customerOid = new mongoose.Types.ObjectId(String(customerId));

    const orderFilter = {
      user_id: customerOid,
      deleted_at: null,
    };

    if (query.order_id !== undefined && String(query.order_id).trim() !== '') {
      if (!mongoose.Types.ObjectId.isValid(String(query.order_id))) {
        return fail(400, 'Invalid order_id filter.');
      }
      orderFilter._id = new mongoose.Types.ObjectId(String(query.order_id));
    }

    const orderIds = await Order.find(orderFilter).distinct('_id');
    if (orderIds.length === 0) {
      return ok(200, {
        message: 'Order payments fetched.',
        data: {
          totalItems: 0,
          totalPages: 0,
          currentPage: page,
          limit,
          records: [],
        },
      });
    }

    const paymentFilter = {
      order_id: { $in: orderIds },
      payer_type: PAYER_TYPE_CUSTOMER,
      deleted_at: null,
    };

    if (query.status !== undefined && String(query.status).trim() !== '') {
      paymentFilter.status = String(query.status).trim().toLowerCase();
    }
    if (query.payment_method !== undefined && String(query.payment_method).trim() !== '') {
      paymentFilter.payment_method = String(query.payment_method).trim().toLowerCase();
    }

    const dateRangeResult = buildFieldDateRangeFilter(query, 'created_at');
    if (!dateRangeResult.ok) {
      return fail(400, dateRangeResult.message);
    }
    Object.assign(paymentFilter, dateRangeResult.filter);

    const { data, totalCount, totalPages, currentPage } = await applyPagination(
      OrderPayment,
      paymentFilter,
      page,
      limit,
      { created_at: -1 }
    );

    const uniqueOrderIds = [...new Set(data.map((row) => String(row.order_id)))];
    const orders = await Order.find({ _id: { $in: uniqueOrderIds } })
      .select(
        'unique_id payment_status user_payment_status is_paid total_price customer_paid_amount customer_due_amount customer_net_paid'
      )
      .lean();
    const orderById = Object.fromEntries(orders.map((order) => [String(order._id), order]));

    const records = data.map((row) => ({
      ...row,
      order: orderById[String(row.order_id)] || null,
    }));

    return ok(200, {
      message: 'Order payments fetched.',
      data: {
        totalItems: totalCount,
        totalPages,
        currentPage,
        limit,
        records,
      },
    });
  } catch (err) {
    console.error('mobile user list all order payments', err.message);
    return fail(500, 'Internal server error.');
  }
};

const listCustomerOrderPayments = async (customerId, orderId) => {
  try {
    const access = await loadCustomerOrder(customerId, orderId);
    if (!access.ok) return access;

    const rows = await OrderPayment.find({
      order_id: access.data.order._id,
      payer_type: PAYER_TYPE_CUSTOMER,
      deleted_at: null,
    })
      .sort({ created_at: -1 })
      .lean();

    return ok(200, {
      message: 'Order payments fetched.',
      records: rows,
    });
  } catch (err) {
    console.error('mobile user list order payments', err.message);
    return fail(500, 'Internal server error.');
  }
};

const createCustomerOrderPayment = async (customerId, orderId, body) => {
  try {
    const access = await loadCustomerOrder(customerId, orderId);
    if (!access.ok) return access;

    const order = access.data.order;
    const { doc, syncResult } = await createOrderPaymentRecord(order, body, {
      payerType: PAYER_TYPE_CUSTOMER,
      autoPaidAtOnCompleted: true,
      trimStrings: true,
    });
    const syncedOrder = syncResult?.order;
    const breakdown = syncResult?.breakdown;

    return ok(201, {
      message: 'Order payment record created.',
      record: doc.toObject(),
      order: syncedOrder
        ? formatMobileCustomerOrderSummary(syncedOrder, breakdown)
        : null,
    });
  } catch (err) {
    console.error('mobile user create order payment', err.message);
    return fail(500, 'Internal server error.');
  }
};

const loadCustomerPaymentOnOrder = async (customerId, orderId, paymentId) => {
  const access = await loadCustomerOrder(customerId, orderId);
  if (!access.ok) return access;

  if (!paymentId || !mongoose.Types.ObjectId.isValid(String(paymentId))) {
    return fail(400, 'Invalid payment id.');
  }

  const row = await OrderPayment.findOne({
    _id: paymentId,
    order_id: access.data.order._id,
    payer_type: PAYER_TYPE_CUSTOMER,
    deleted_at: null,
  });

  if (!row) {
    return fail(404, 'Payment not found.');
  }

  return ok(200, { order: access.data.order, payment: row });
};

const updateCustomerOrderPayment = async (customerId, orderId, paymentId, body) => {
  try {
    const loaded = await loadCustomerPaymentOnOrder(customerId, orderId, paymentId);
    if (!loaded.ok) return loaded;

    const row = loaded.data.payment;
    const order = loaded.data.order;

    const updateResult = await updateOrderPaymentRecord(row, order, body, {
      validateStatus: false,
      trimStrings: true,
    });
    if (!updateResult.ok) {
      return fail(updateResult.status, updateResult.message);
    }

    const syncedOrder = updateResult.syncResult?.order;
    const breakdown = updateResult.syncResult?.breakdown;

    return ok(200, {
      message: 'Order payment updated.',
      record: updateResult.row.toObject(),
      order: syncedOrder
        ? formatMobileCustomerOrderSummary(syncedOrder, breakdown)
        : null,
    });
  } catch (err) {
    console.error('mobile user update order payment', err.message);
    return fail(500, 'Internal server error.');
  }
};

const deleteCustomerOrderPayment = async (customerId, orderId, paymentId) => {
  try {
    const loaded = await loadCustomerPaymentOnOrder(customerId, orderId, paymentId);
    if (!loaded.ok) return loaded;

    const row = loaded.data.payment;
    const order = loaded.data.order;

    const syncResult = await softDeleteOrderPaymentRecord(row, order._id);
    const breakdown = syncResult?.breakdown;

    return ok(200, {
      message: 'Order payment deleted.',
      order_payment_status: breakdown?.payment_status,
    });
  } catch (err) {
    console.error('mobile user delete order payment', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listAllCustomerOrderPayments,
  listCustomerOrderPayments,
  createCustomerOrderPayment,
  updateCustomerOrderPayment,
  deleteCustomerOrderPayment,
};
