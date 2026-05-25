const fs = require('fs');
const mongoose = require('mongoose');
const Order = require('../models/order');
const User = require('../models/user');
const Service = require('../models/service');
const Category = require('../models/category');
const City = require('../models/city');
const State = require('../models/state');
const Address = require('../models/address');
const Franchise = require('../models/franchise');
const NotificationSettings = require('../models/notification_settings');
const OrderService = require('../models/order_services');
const { applyPagination } = require('../utils/pagination');
const { validationResult } = require('express-validator');
const { parseBoolean } = require('../utils/parser');
const { sendTemplateEmail } = require('../helper/mail');
const { buildOrderInvoiceHtml } = require('../utils/order_invoice_html');
const { getOrderId } = require('../helper/id_generator');
const { checkObjectIdExists } = require('../validator/id_validator');
const { fieldLabel } = require('../utils/field_labels');
const {
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_IN_PROGRESS,
  ORDER_STATUS_REFUNDED,
  ORDER_STATUSES,
  isOrderStatusWithNoPendingAmounts,
  normalizeOrderStatus,
  buildOrderStatusQueryFilter,
  getOrderStatusLabel,
  touchOrderStatusInfo,
} = require('../enum/order_status_enum');
const { assertOrderCanBeMarkedCompleted } = require('../services/order_completion_validation');
const { sendPushNotification } = require('../service/firebase/push_service');
const { generatePaymentLink } = require('./razorpay_controller');
const { escapeRegExp } = require('../utils/string_helpers');
const { isMongoObjectIdHex, buildObjectIdQueryFilters } = require('../utils/mongoose_helpers');
const {
  resolveSortField,
  resolveSortDir,
  resolveListStatusFilter,
  resolveListSearchRegex,
} = require('../utils/list_query_helpers');
const { buildOrderDateRangeFilter } = require('../utils/schedule_date_filters');
const {
  buildEntityListPipeline,
  parseFacetListResult,
  getListCollectionNames,
} = require('../utils/list_aggregation');
const {
  formatOrderForApi,
  formatOrderRecords,
  formatOrderServiceItemForApi,
} = require('../utils/order_api_format');

const ORDER_LIST_SEARCH_FIELDS = [
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
  '_partner.name',
  '_partner.user_id',
  '_partner.email',
  '_partner.phone_number',
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
const OrderAdditionalCharge = require('../models/order_additional_charge');
const OrderPayment = require('../models/order_payment');
const OrderOffer = require('../models/order_offer');
const Quote = require('../models/quote');
const { computeOrderTotal, recalculateOrderTotals } = require('../utils/order_financials');
const {
  isValidOrderPaymentStatus,
  isValidPartnerPaymentStatus,
} = require('../enum/order_payment_status_enum');
const {
  OrderCreationError,
  createOrderFromBody,
  persistOrderAndLinkQuote,
} = require('../services/order_creation_service');
const {
  isRepricingRequested,
  repriceOrderOnUpdate,
} = require('../services/order_update_pricing_service');
const {
  applyNestedResourcesOnUpdate,
} = require('../services/order_nested_resources_service');
const { syncAllPartnerOrderPaymentsForOrder } = require('../services/partner_wallet_order_service');
const { syncOrderPaymentStatus } = require('../services/order_payment_status_service');
const {
  applyOrderFieldsAndServicesUpdate,
} = require('../services/order_field_update_service');
const { attachRefundsToOrderRecords } = require('../services/refund_service');
const {
  resolveOrderListScope,
  assertOrderRecordAccess,
  assertCallerCanManageOrders,
  assertCallerCanAssignFranchise,
  resolveCallerFranchiseId,
} = require('../utils/order_access');

const ORDER_DETAIL_POPULATE = [
  {
    path: "user_id",
    select: 'name user_id email phone_number profile_url city_id',
    populate: [{ path: "city_id", select: 'name' }],
  },
  { path: "city_id", select: 'name city_service_price' },
  { path: "category_id", select: 'name category_id desc image_url' },
  { path: "created_by_id", select: 'name user_id email phone_number profile_url' },
  {
    path: "partner_id",
    select: 'name user_id email phone_number profile_url city_id',
    populate: [{ path: "city_id", select: 'name' }],
  },
  { path: "employee_id", select: 'name user_id email phone_number profile_url' },
  { path: "franchise_id", select: 'name city_name state_name' },
  { path: "address_id" },
  { path: "service_id", select: 'name service_id desc image_url' },
  {
    path: "quote_id",
    select:
      "quote_sequence_id status quote_description service_price from_date to_date created_at",
  },
  {
    path: "service_items",
    populate: [
      {
        path: "partner_id",
        select: 'name user_id email phone_number profile_url city_id',
        populate: [{ path: "city_id", select: 'name' }],
      },
      { path: "service_id", select: 'name service_id desc image_url' },
    ],
  },
];

function shapeOrderDetailResponse(populatedOrderData, additional_charges, order_payments, order_offer) {
  return formatOrderForApi({
    ...populatedOrderData,
    created_by_id: populatedOrderData.created_by_id?._id ?? populatedOrderData.created_by_id,
    created_by_info: populatedOrderData.created_by_id,
    created_by_name: populatedOrderData.created_by_id?.name,

    user_id: populatedOrderData.user_id?._id ?? populatedOrderData.user_id,
    user_info: populatedOrderData.user_id
      ? {
          ...populatedOrderData.user_id,
          city_name: populatedOrderData.user_id.city_id?.name || null,
          city_id: populatedOrderData.user_id.city_id?._id || null,
        }
      : null,

    city_id: populatedOrderData.city_id?._id ?? populatedOrderData.city_id,
    city_info: populatedOrderData.city_id,

    category_id: populatedOrderData.category_id?._id ?? populatedOrderData.category_id,
    category_info: populatedOrderData.category_id,

    partner_id: populatedOrderData.partner_id?._id ?? populatedOrderData.partner_id,
    partner_info:
      populatedOrderData.partner_id && populatedOrderData.partner_id._id
        ? {
            ...populatedOrderData.partner_id,
            city_name: populatedOrderData.partner_id.city_id?.name || null,
            city_id: populatedOrderData.partner_id.city_id?._id || null,
          }
        : null,

    employee_id: populatedOrderData.employee_id?._id ?? populatedOrderData.employee_id,
    employee_info: populatedOrderData.employee_id?._id ? populatedOrderData.employee_id : null,

    franchise_id: populatedOrderData.franchise_id?._id ?? populatedOrderData.franchise_id,
    franchise_info: populatedOrderData.franchise_id?._id ? populatedOrderData.franchise_id : null,

    address_id: populatedOrderData.address_id?._id ?? populatedOrderData.address_id,
    address_info: populatedOrderData.address_id?._id ? populatedOrderData.address_id : null,

    service_id: populatedOrderData.service_id?._id ?? populatedOrderData.service_id,
    service_info: populatedOrderData.service_id?._id ? populatedOrderData.service_id : null,

    quote_id: populatedOrderData.quote_id?._id ?? populatedOrderData.quote_id,
    quote_info: populatedOrderData.quote_id?._id ? populatedOrderData.quote_id : null,

    service_items: (populatedOrderData.service_items || []).map((serviceItem) => {
      const hasValidPartner = serviceItem.partner_id && serviceItem.partner_id._id;

      return {
        ...serviceItem,
        ...(hasValidPartner && {
          partner_info: {
            ...serviceItem.partner_id,
            city_name: serviceItem.partner_id.city_id?.name || null,
            city_id: serviceItem.partner_id.city_id?._id || null,
          },
        }),
        service_info: serviceItem.service_id,
        partner_id: undefined,
        service_id: undefined,
      };
    }),

    additional_charges,
    order_payments,
    order_offer: order_offer || null,
  });
}

/**
 * Resolve order by Mongo _id (24-char hex) or business unique_id (e.g. O1001, SOS-…).
 * Excludes soft-deleted orders (deleted_at set).
 */
async function resolveOrderByIdParam(id) {
  const trimmed = String(id ?? '').trim();
  if (!trimmed || trimmed === ':id') {
    return null;
  }

  if (isMongoObjectIdHex(trimmed)) {
    const byId = await Order.findOne({ _id: trimmed, deleted_at: null });
    if (byId) return byId;
  }

  return Order.findOne({
    unique_id: new RegExp(`^${escapeRegExp(trimmed)}$`, 'i'),
    deleted_at: null,
  });
}

async function loadOrderDetailLean(orderMongoId) {
  const populatedOrderData = await Order.findById(orderMongoId).populate(ORDER_DETAIL_POPULATE).lean();
  if (!populatedOrderData) return null;
  const [additional_charges, order_payments, order_offer] = await Promise.all([
    OrderAdditionalCharge.find({ order_id: orderMongoId, deleted_at: null })
      .sort({ created_at: -1 })
      .lean(),
    OrderPayment.find({ order_id: orderMongoId, deleted_at: null }).sort({ created_at: -1 }).lean(),
    OrderOffer.findOne({ order_id: orderMongoId }).lean(),
  ]);
  const shaped = shapeOrderDetailResponse(
    populatedOrderData,
    additional_charges,
    order_payments,
    order_offer
  );
  const [withRefunds] = await attachRefundsToOrderRecords([shaped]);
  return withRefunds;
}

/** Same pattern as quote getAll: `sort_by` whitelist + `sort_order` or legacy `sort` (1 | -1). */
const ORDER_SORT_WHITELIST = new Set([
  'created_at',
  'updated_at',
  'order_date',
  'order_status',
  'total_price',
  'sub_total',
  'unique_id',
  'is_paid',
  'payment_status',
  'tax',
  'min_deposit',
  'order_description',
]);

const resolveOrderListStatusFilter = (orderStatusParam) =>
  resolveListStatusFilter(orderStatusParam, {
    buildFilter: (raw) => buildOrderStatusQueryFilter(raw),
    invalidMessage: `Invalid ${fieldLabel('order_status')}. Use one of: ${ORDER_STATUSES.join(', ')}.`,
  });

const getAll = async (req, res) => {
  try {
    const scopeResult = await resolveOrderListScope(req, {
      franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scopeResult.ok) {
      return res.status(scopeResult.status).json({
        success: false,
        status: scopeResult.status,
        message: scopeResult.message,
      });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const statusFilterResult = resolveOrderListStatusFilter(req.query.order_status);
    if (!statusFilterResult.ok) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: statusFilterResult.message,
      });
    }

    const is_paid =
      req.query.is_paid !== undefined && req.query.is_paid !== ''
        ? parseBoolean(req.query.is_paid)
        : null;

    const user_payment_status_raw =
      req.query.user_payment_status !== undefined &&
      req.query.user_payment_status !== null &&
      String(req.query.user_payment_status).trim() !== ''
        ? String(req.query.user_payment_status).trim().toLowerCase()
        : null;

    const payment_status_raw =
      user_payment_status_raw ||
      (req.query.payment_status !== undefined &&
      req.query.payment_status !== null &&
      String(req.query.payment_status).trim() !== ''
        ? String(req.query.payment_status).trim().toLowerCase()
        : null);

    if (payment_status_raw && !isValidOrderPaymentStatus(payment_status_raw)) {
      return res.status(409).json({
        success: false,
        status: 409,
        message:
          `Invalid ${fieldLabel('user_payment_status')} / ${fieldLabel('payment_status')}. Use: unpaid, paid, partially_paid, refund, partially_refund.`,
      });
    }

    const partner_payment_status_raw =
      req.query.partner_payment_status !== undefined &&
      req.query.partner_payment_status !== null &&
      String(req.query.partner_payment_status).trim() !== ''
        ? String(req.query.partner_payment_status).trim().toLowerCase()
        : null;

    if (
      partner_payment_status_raw &&
      !isValidPartnerPaymentStatus(partner_payment_status_raw)
    ) {
      return res.status(409).json({
        success: false,
        status: 409,
        message:
          `Invalid ${fieldLabel('partner_payment_status')}. Use: unpaid, partially_paid, paid.`,
      });
    }

    const regex = resolveListSearchRegex(req, { legacyKeyword: true });

    const dateRangeResult = buildOrderDateRangeFilter(req.query);
    if (!dateRangeResult.ok) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: dateRangeResult.message,
      });
    }

    const baseFilter = {
      deleted_at: null,
      ...scopeResult.filter,
      ...dateRangeResult.filter,
      ...statusFilterResult.filter,
      ...(is_paid !== null && { is_paid }),
      ...(payment_status_raw && {
        payment_status: payment_status_raw,
        user_payment_status: payment_status_raw,
      }),
      ...(partner_payment_status_raw && {
        partner_payment_status: partner_payment_status_raw,
      }),
      ...buildObjectIdQueryFilters(req.query, [
        'user_id',
        'partner_id',
        'employee_id',
        'city_id',
        'category_id',
        'service_id',
      ]),
    };

    const sortField = resolveSortField(req.query.sort_by, ORDER_SORT_WHITELIST);
    const sortDir = resolveSortDir(req);
    const sortStage = { [sortField]: sortDir };

    const collections = getListCollectionNames({
      users: User,
      categories: Category,
      services: Service,
      cities: City,
      franchise: Franchise,
      quotes: Quote,
      address: Address,
      states: State,
      orderServices: OrderService,
    });

    const pipeline = buildEntityListPipeline({
      baseFilter,
      sortStage,
      skip,
      limit,
      regex,
      searchFields: ORDER_LIST_SEARCH_FIELDS,
      collections,
      includeRootCityLookup: true,
      includeQuoteLookup: true,
      includeServiceItemsLookup: true,
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
    });

    const result = await Order.aggregate(pipeline)
      .collation({ locale: 'en', strength: 2 })
      .exec();

    const { data: orders, totalCount, totalPages } = parseFacetListResult(
      result,
      limit
    );

    const records = await attachRefundsToOrderRecords(formatOrderRecords(orders));

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Order list fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage: page,
      records,
    });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: err.message,
    });
  }
};

const getCustomerOrder = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const filter = {
      deleted_at: null,
    };
    const user_id = req.query.user_id;
    if (!user_id || user_id === undefined || user_id.trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Please enter user id",
      });
    }
    const userResult = checkObjectIdExists(User, user_id, 'user');
    if (userResult.exists === false) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: userResult.message,
      });
    }
    filter.user_id = new mongoose.Types.ObjectId(user_id);
    const sort = { created_at: -1 };

    const { data: orders, totalCount, totalPages, currentPage } = await applyPagination(
      Order,
      filter,
      page,
      limit,
      sort
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: "Order list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: formatOrderRecords(orders),
    });
  } catch (err) {
    console.error("Error fetching orders list:", err);
    res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
      error: err.message,
    });
  }
};

const getCustomerOrderDetails = async (req, res) => {
  const { id } = req.params;

  try {
    let order;
    if (/^sos-/i.test(id)) {
      order = await Order.findOne({ unique_id: new RegExp(`^${id}$`, "i") });
    } else {
      order = await Order.findById(id);
    }
    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    const record = await loadOrderDetailLean(order._id);
    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Order details fetched successfully',
      record,
    });
  } catch (error) {
    console.error('Error fetching Order details:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const create = async (req, res) => {
  try {
    const { name, email, contact } = req.body;

    const managerCheck = await assertCallerCanManageOrders(req);
    if (!managerCheck.ok) {
      return res.status(managerCheck.status).json({
        success: false,
        status: managerCheck.status,
        message: managerCheck.message,
      });
    }

    const callerFranchiseId = await resolveCallerFranchiseId(
      managerCheck.caller,
      managerCheck.callerId
    );

    let draft;
    try {
      draft = await createOrderFromBody(req.body, {
        linkQuote: true,
        callerFranchiseId,
        callerType: managerCheck.caller.type,
      });
    } catch (err) {
      if (err instanceof OrderCreationError) {
        return res.status(err.status).json({
          success: false,
          status: err.status,
          message: err.message,
        });
      }
      throw err;
    }

    const { newOrder, order_id, pricingMeta } = draft;

    const franchiseCheck = await assertCallerCanAssignFranchise(
      req,
      newOrder.franchise_id
    );
    if (!franchiseCheck.ok) {
      return res.status(franchiseCheck.status).json({
        success: false,
        status: franchiseCheck.status,
        message: franchiseCheck.message,
      });
    }

    if (newOrder.payment_mode_id === "2") {
      const responsePaymentLink = await generatePaymentLink(
        name,
        email,
        contact,
        newOrder.total_price
      );
      if (responsePaymentLink.success === true) {
        newOrder.transaction_id = responsePaymentLink.transaction_id;
        const { order: savedOrder, nested } = await persistOrderAndLinkQuote(draft, {
          requestBody: req.body,
        });
        const result = {
          payment_url: responsePaymentLink.payment_url,
          order_id: savedOrder._id,
          pricing: pricingMeta,
          ...(nested ? { nested } : {}),
        };
        return res.status(200).json({
          success: true,
          status: 200,
          message: "Order placed successfully and payment link send to customer.",
          record: result,
        });
      }
      return res.status(502).json({
        success: false,
        status: 502,
        message: responsePaymentLink.error || "Failed to create payment link.",
      });
    }

    const { order: savedOrder, nested } = await persistOrderAndLinkQuote(draft, {
      requestBody: req.body,
    });
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Order placed successfully.",
      record: {
        order_id: savedOrder._id,
        pricing: pricingMeta,
        ...(nested ? { nested } : {}),
      },
    });
  } catch (error) {
    if (error instanceof OrderCreationError) {
      return res.status(error.status).json({
        success: false,
        status: error.status,
        message: error.message,
      });
    }
    if (error.message === "INVALID_SERVICE_USER") {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `Invalid ${fieldLabel('user_id')} on ${fieldLabel('service_items')}.`,
      });
    }
    console.error("Error creating Order:", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const update = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;


  try {

    const order = await Order.findOne({ _id: id, deleted_at: null });

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    const access = await assertOrderRecordAccess(req, order);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'franchise_id')) {
      const franchiseAssignCheck = await assertCallerCanAssignFranchise(
        req,
        req.body.franchise_id === null || req.body.franchise_id === ''
          ? null
          : req.body.franchise_id
      );
      if (!franchiseAssignCheck.ok) {
        return res.status(franchiseAssignCheck.status).json({
          success: false,
          status: franchiseAssignCheck.status,
          message: franchiseAssignCheck.message,
        });
      }
    }

    try {
      const fieldUpdateResult = await applyOrderFieldsAndServicesUpdate(order, req.body);
      if (fieldUpdateResult.triggerRepriceFromLine) {
        req.body.total_service_charge = fieldUpdateResult.lineChargeForReprice;
      }
    } catch (err) {
      if (err instanceof OrderCreationError) {
        return res.status(err.status).json({
          success: false,
          status: err.status,
          message: err.message,
        });
      }
      throw err;
    }

    let repriceResult = null;
    if (isRepricingRequested(req.body)) {
      try {
        repriceResult = await repriceOrderOnUpdate(order, req.body);
      } catch (err) {
        if (err instanceof OrderCreationError) {
          return res.status(err.status).json({
            success: false,
            status: err.status,
            message: err.message,
          });
        }
        throw err;
      }
    }

    const orderToUpdate = repriceResult?.order ?? order;
    const { order_status } = req.body;

    const updateData = {};
    let pendingCompletion = false;
    let requestedOrderStatus = null;

    if (order_status !== undefined) {
      const nextStatus = normalizeOrderStatus(order_status);
      if (!nextStatus) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: `Invalid ${fieldLabel('order_status')}. Use one of: ${ORDER_STATUSES.join(', ')}.`,
        });
      }
      requestedOrderStatus = nextStatus;
      if (nextStatus !== orderToUpdate.order_status) {
        if (nextStatus === ORDER_STATUS_COMPLETED) {
          pendingCompletion = true;
        } else {
          touchOrderStatusInfo(orderToUpdate, nextStatus);
          orderToUpdate.order_status = nextStatus;
          updateData.service_status = nextStatus;
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      const updateCondition = {
        _id: { $in: orderToUpdate.service_items },
        service_status: { $nin: [ORDER_STATUS_CANCELLED, ORDER_STATUS_REFUNDED] },
      };

      await OrderService.updateMany(
        updateCondition,
        { $set: updateData }
      );
    }

    orderToUpdate.updated_at = new Date();
    let updatedOrder = await orderToUpdate.save();

    let nested = null;
    try {
      nested = await applyNestedResourcesOnUpdate(updatedOrder, req.body);
    } catch (err) {
      if (err instanceof OrderCreationError) {
        return res.status(err.status).json({
          success: false,
          status: err.status,
          message: err.message,
        });
      }
      throw err;
    }

    if (nested) {
      updatedOrder = await Order.findById(updatedOrder._id);
    }

    if (
      pendingCompletion &&
      requestedOrderStatus === ORDER_STATUS_COMPLETED &&
      updatedOrder.order_status !== ORDER_STATUS_COMPLETED
    ) {
      const completionCheck = await assertOrderCanBeMarkedCompleted(updatedOrder);
      if (!completionCheck.ok) {
        return res.status(completionCheck.status).json({
          success: false,
          status: completionCheck.status,
          message: completionCheck.message,
        });
      }

      touchOrderStatusInfo(updatedOrder, ORDER_STATUS_COMPLETED);
      updatedOrder.order_status = ORDER_STATUS_COMPLETED;
      await OrderService.updateMany(
        {
          _id: { $in: updatedOrder.service_items },
          service_status: { $nin: [ORDER_STATUS_CANCELLED, ORDER_STATUS_REFUNDED] },
        },
        { $set: { service_status: ORDER_STATUS_COMPLETED, updated_at: new Date() } }
      );
      updatedOrder.updated_at = new Date();
      updatedOrder = await updatedOrder.save();
    }

    if (isOrderStatusWithNoPendingAmounts(updatedOrder.order_status)) {
      await syncOrderPaymentStatus(updatedOrder._id);
      updatedOrder = await Order.findById(updatedOrder._id);
    }

    const notificationSetting = await NotificationSettings.findOne({
      user_id: updatedOrder.user_id,
    });
    if (notificationSetting?.is_update_allow) {
      const user = await User.findById(updatedOrder.user_id);
      const deviceToken = user?.device_token
      const title = `Order Status Update`
      const body = `Your Order #${updatedOrder.unique_id} status changed to ${getOrderStatusLabel(updatedOrder.order_status)}`
      const data = {
        order_id: updatedOrder.id,
        order_status: updatedOrder.order_status,
        type: "Order"
      }
      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({ deviceToken, title, body, data });
      }
    }
    if (notificationSetting?.is_sms_allow) {
      // Put logic for sent sms update
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Order updated successfully',
      record: formatOrderForApi(updatedOrder),
      ...(nested ? { nested } : {}),
      ...(repriceResult
        ? {
            pricing: {
              total_service_charge: repriceResult.pricing.total_service_charge,
              commission_amount: repriceResult.pricing.commission_amount,
              tax_amount: repriceResult.pricing.tax_amount,
              sub_total: repriceResult.pricing.sub_total,
              discount_amount: repriceResult.pricing.discount_amount,
              total_price: repriceResult.pricing.total_price,
              minimum_deposit_amount: repriceResult.pricing.minimum_deposit_amount,
            },
            order_offer: repriceResult.order_offer,
          }
        : {}),
    });
  }
  catch (error) {
    if (error instanceof OrderCreationError) {
      return res.status(error.status).json({
        success: false,
        status: error.status,
        message: error.message,
      });
    }
    console.error('Error updating Order:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const serviceUpdate = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const updateData = { ...req.body };

  if (updateData.service_status !== undefined) {
    const normalized = normalizeOrderStatus(updateData.service_status);
    if (!normalized) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: `Invalid ${fieldLabel('service_status')}. Use one of: ${ORDER_STATUSES.join(', ')}.`,
      });
    }
    updateData.service_status = normalized;
  }

  const wantsLineCompleted =
    updateData.service_status === ORDER_STATUS_COMPLETED;

  try {
    const service = await OrderService.findById(id);

    if (!service) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Order Service  not found'
      });
    }

    const parentOrder = await Order.findOne({
      _id: service.order_id,
      deleted_at: null,
    });
    if (!parentOrder) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found',
      });
    }
    const serviceAccess = await assertOrderRecordAccess(req, parentOrder);
    if (!serviceAccess.ok) {
      return res.status(serviceAccess.status).json({
        success: false,
        status: serviceAccess.status,
        message: serviceAccess.message,
      });
    }

    if (
      wantsLineCompleted &&
      service.service_status !== ORDER_STATUS_COMPLETED
    ) {
      const completionCheck = await assertOrderCanBeMarkedCompleted(parentOrder);
      if (!completionCheck.ok) {
        return res.status(completionCheck.status).json({
          success: false,
          status: completionCheck.status,
          message: completionCheck.message,
        });
      }
    }

    const originalPartnerId = service.partner_id?.toString();
    const originalServiceDate = service.service_date;
    const originalFromTime = service.service_from_time;
    const originalToTime = service.service_to_time;

    Object.keys(updateData).forEach((key) => {
      if (key === 'partner_id' ||
        key === 'service_date' ||
        key === 'service_from_time' ||
        key === 'service_to_time' ||
        key === 'service_status' ||
        key === 'is_paid'
      ) {
        service[key] = updateData[key];
      }
    });
    const partner = await User.findById(new mongoose.Types.ObjectId(service.partner_id));
    if (!partner) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Partner user not found for this service.',
      });
    }
    service.partner_unique_id = partner.user_id;
    const updatedService = await service.save();



    if (originalPartnerId && originalPartnerId !== service.partner_id?.toString()) {
      const oldPartner = await User.findById(originalPartnerId);
      const newPartner = await User.findById(service.partner_id);
      const serviceData = await Service.findById(service.service_id);

      // Notify old partner about cancellation
      const oldDeviceToken = oldPartner.device_token;
      if (oldDeviceToken !== null && oldDeviceToken !== '') {
        const title = "Service Cancelled";
        const body = `Service for order #${service.order_unique_id} has been cancelled from your list.`;
        const data = { order_id: service.order_id.toString(), type: "Order" };
        await sendPushNotification({
          deviceToken: oldDeviceToken,
          title,
          body,
          data
        });
      }

      // Notify new partner about new assignment
      const newDeviceToken = newPartner.device_token;
      if (newDeviceToken !== null && newDeviceToken !== '') {
        const title = "New Service Assigned";
        const body = `You have a new service (${serviceData.name}) for order #${service.order_unique_id}.`;
        const data = { order_id: service.order_id.toString(), type: "Order" };
        await sendPushNotification({
          newDeviceToken,
          title,
          body,
          data,
        });
      }
    }else if (
      originalServiceDate !== service.service_date ||
      originalFromTime !== service.service_from_time ||
      originalToTime !== service.service_to_time
    ) {
      const partner = await User.findById(service.partner_id);
      const deviceToken = partner.device_token;
      const serviceData = await Service.findById(service.service_id);

      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({
          deviceToken,
          title: "Service Time Updated",
          body: `Time updated for service (${serviceData.name}) of order #${service.order_unique_id}`,
          data: { order_id: service.order_id.toString(), type: "Order" }
        });
      }
    }else if (partner && service.service_status === ORDER_STATUS_IN_PROGRESS) {
      const partnerNotifySettings = await NotificationSettings.findOne({ user_id: service.partner_id });
      if (partnerNotifySettings?.is_update_allow) {
        const serviceData = await Service.findById(service.service_id);
        const deviceToken = partner.device_token
        const title = `New Service Request Received`
        const body = `You received request for ${serviceData.name} for order #${service.order_unique_id}`
        const data = {
          order_id: service.order_id.toString(),
          type: "Order"
        }
        if (deviceToken !== null && deviceToken !== '') {
          await sendPushNotification({ deviceToken, title, body, data });
        }
      }
      if (partnerNotifySettings?.is_sms_allow) {
        // Put logic for sent sms update
      }
    }
    const userNotifySettings = await NotificationSettings.findOne({ user_id: service.user_id });
    if (userNotifySettings?.is_update_allow) {
      const user = await User.findById(service.user_id);
      const serviceData = await Service.findById(service.service_id);
      const deviceToken = user?.device_token
      const title = `Service Update`
      const body = `Your ${serviceData.name} status changed to ${getOrderStatusLabel(service.service_status)} for order #${service.order_unique_id}`
      const data = {
        order_id: service.order_id.toString(),
        type: "Order"
      }
      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({ deviceToken, title, body, data });
      }
    }
    if (userNotifySettings?.is_sms_allow) {
      // Put logic for sent sms update
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Order Service updated successfully',
      record: formatOrderServiceItemForApi(updatedService),
    });
  } catch (error) {
    console.error('Error updating Order Service:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const cancleService = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;

  if (req.body.service_items_id === undefined || req.body.service_items_id.trim() === '') {
    return res.status(409).json({
      success: false,
      status: 409,
      message: 'Service id require'
    });
  }
  const service_items_id = new mongoose.Types.ObjectId(req.body.service_items_id);



  try {

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    if (order.deleted_at) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found',
      });
    }

    const cancelServiceAccess = await assertOrderRecordAccess(req, order);
    if (!cancelServiceAccess.ok) {
      return res.status(cancelServiceAccess.status).json({
        success: false,
        status: cancelServiceAccess.status,
        message: cancelServiceAccess.message,
      });
    }

    let body;
    let partner;
    if (!order.service_items.some((sid) => sid.equals(service_items_id))) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Service id not found'
      });
    }

    const serviceData = await OrderService.findById(service_items_id);
    if (!serviceData) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Service line not found'
      });
    }

    partner = await User.findById(serviceData.partner_id);
    order.total_service_charge -=
      Number(serviceData.total_service_charge ?? serviceData.service_price) || 0;
    order.commission_amount -=
      Number(serviceData.commission_amount ?? serviceData.partner_commison_platform_fee) || 0;
    order.admin_commission = order.commission_amount;
    order.sub_total -= serviceData.sub_total;
    order.tax_amount -= Number(serviceData.tax_amount ?? serviceData.tax) || 0;
    order.tax = order.tax_amount;
    order.user_paltform_fee = 0;
    order.partner_commison_platform_fee = order.commission_amount;
    order.admin_earning -= serviceData.admin_earning;
    await OrderService.findByIdAndUpdate(service_items_id,
      { service_status: ORDER_STATUS_CANCELLED },
      { new: true, runValidators: true }
    );

    const serviceInfo = serviceData.service_id
      ? await Service.findById(serviceData.service_id)
      : null;
    body = serviceInfo
      ? `Your ${serviceInfo.name} for order #${order.unique_id} has been cancelled`
      : `A service for order #${order.unique_id} has been cancelled`;
    const updatedOrder = await order.save();
    await recalculateOrderTotals(order._id);

    if (partner) {
      const notificationSetting = await NotificationSettings.findOne({ user_id: partner._id });
      if (notificationSetting?.is_update_allow) {
        const deviceToken = partner.device_token
        const title = `Service cancel`
        const data = {
          order_id: order.id,
          type: "Order"
        }
        if (deviceToken !== null && deviceToken !== '') {
          await sendPushNotification({ deviceToken, title, body, data });
        }
      }
      if (notificationSetting?.is_sms_allow) {
        // Put logic for sent sms update
      }
    }

    const notificationSettingUser = await NotificationSettings.findOne({ user_id: order.user_id });
    if (notificationSettingUser?.is_update_allow) {
      const user = await User.findById(order.user_id);
      const deviceToken = user?.device_token
      const title = `Service cancel`
      const data = {
        order_id: order.id,
        type: "Order"
      }
      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({ deviceToken, title, body, data });
      }
    }
    if (notificationSettingUser?.is_sms_allow) {
      // Put logic for sent sms update
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Order updated successfully',
      record: formatOrderForApi(updatedOrder),
    });
  }
  catch (error) {
    console.error('Error updating Order:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const cancleOrder = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const { cancellation_reasone } = req.body;
  console.log('cancellation_reason is', cancellation_reasone);
  try {

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    if (order.deleted_at) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found',
      });
    }

    const cancelAccess = await assertOrderRecordAccess(req, order);
    if (!cancelAccess.ok) {
      return res.status(cancelAccess.status).json({
        success: false,
        status: cancelAccess.status,
        message: cancelAccess.message,
      });
    }

    order.order_status = ORDER_STATUS_CANCELLED;
    order.cancellation_reasone = cancellation_reasone || '';
    touchOrderStatusInfo(order, ORDER_STATUS_CANCELLED);
    await order.save();

    await OrderService.updateMany(
      { _id: { $in: order.service_items } },
      {
        $set: {
          service_status: ORDER_STATUS_CANCELLED,
          cancellation_reasone: cancellation_reasone || ''
        }
      }
    );

    await syncOrderPaymentStatus(order._id);
    await syncAllPartnerOrderPaymentsForOrder(order._id);
    const updatedOrder = await Order.findById(order._id);

    const orderServices = await OrderService.find({
      _id: { $in: order.service_items }
    }).select("partner_id");
    console.log(orderServices);
    const notificationPromises = orderServices.map(async (service) => {
      const partnerId = service.partner_id;
      console.log(partnerId);
      if (!partnerId) return;

      // Fetch notification setting first
      const setting = await NotificationSettings.findOne({ user_id: partnerId });
      console.log(setting);
      if (!setting?.is_update_allow) return;

      // Fetch partner user and device token
      const partner = await User.findById(partnerId).select("device_token");
      console.log(partner);
      const deviceToken = partner?.device_token;
      console.log(deviceToken);
      if (deviceToken !== null && deviceToken !== '') {
        const title = "Order Cancelled";
        const body = `An order #${order.unique_id} related to your service has been cancelled`;
        const data = {
          order_id: order.id,
          type: "Order"
        };

        return sendPushNotification({
          deviceToken,
          title,
          body,
          data,
        });
      }
    });

    await Promise.all(notificationPromises.filter(Boolean));
    console.log('Notification sent.......');

    const notificationSetting = await NotificationSettings.findOne({ user_id: order.user_id });
    if (notificationSetting?.is_update_allow) {
      const user = await User.findById(order.user_id);
      const deviceToken = user?.device_token
      const title = `Order cancel`
      const body = `Your Order #${order.unique_id} has been cancelled`
      const data = {
        order_id: order.id,
        type: "Order"
      }
      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({ deviceToken, title, body, data });
      }
    }
    if (notificationSetting?.is_sms_allow) {
      // Put logic for sent sms update
    }
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Order cancelled successfully',
      record: formatOrderForApi(updatedOrder),
    });
  }
  catch (error) {
    console.error('Error cancelled Order:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const getById = async (req, res) => {
  const { id } = req.params;

  try {
    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    if (order.deleted_at) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found',
      });
    }

    const access = await assertOrderRecordAccess(req, order);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }

    const record = await loadOrderDetailLean(order._id);
    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    res.status(200).json({
      success: true,
      status: 201,
      message: 'Order fetched successfully',
      record,
    });

  } catch (error) {
    console.error('Error fetching Order:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const deleteOrder = async (req, res) => {
  const { id } = req.params;

  try {

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }


    if (order.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Order is already deleted'
      });
    }

    const deleteAccess = await assertOrderRecordAccess(req, order);
    if (!deleteAccess.ok) {
      return res.status(deleteAccess.status).json({
        success: false,
        status: deleteAccess.status,
        message: deleteAccess.message,
      });
    }

    order.deleted_at = new Date();


    await order.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Order deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Order:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const downloadOrderInvoice = async (req, res) => {
  const { id } = req.params;

  try {
    const order = await resolveOrderByIdParam(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found',
      });
    }

    const access = await assertOrderRecordAccess(req, order);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }

    const record = await loadOrderDetailLean(order._id);
    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found',
      });
    }

    const html = buildOrderInvoiceHtml(record);
    const safeId = String(record.unique_id || order._id).replace(/[^\w-]/g, '_');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${safeId}.html"`);
    return res.status(200).send(html);
  } catch (error) {
    console.error('Error downloading order invoice:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const sendInvoiceEmail = async (req, res) => {
  const { email, html_content, order_id } = req.body;
  const file = req.file;

  try {
    let toEmail = email ? String(email).trim() : '';
    let html = html_content || '';
    const attachments = [];

    if (order_id) {
      const order = await resolveOrderByIdParam(order_id);
      if (!order) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'No record found',
        });
      }

      const access = await assertOrderRecordAccess(req, order);
      if (!access.ok) {
        return res.status(access.status).json({
          success: false,
          status: access.status,
          message: access.message,
        });
      }

      const record = await loadOrderDetailLean(order._id);
      if (!record) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'No record found',
        });
      }

      if (!html) {
        html = buildOrderInvoiceHtml(record);
      }
      if (!toEmail) {
        toEmail = record.user_info?.email ? String(record.user_info.email).trim() : '';
      }
    }

    if (!toEmail) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `Email is required (or provide ${fieldLabel('order_id')} with a customer email on the order).`,
      });
    }

    if (!html && !file) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `${fieldLabel('html_content')}, ${fieldLabel('order_id')}, or a PDF file upload is required.`,
      });
    }

    if (file) {
      attachments.push({
        filename: 'invoice.pdf',
        path: file.path,
      });
    }

    await sendTemplateEmail(
      toEmail,
      'SOS Order Invoice',
      html,
      'Please find your invoice attached.',
      attachments
    );

    if (file?.path) {
      fs.unlinkSync(file.path);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Invoice sent successfully!',
    });
  } catch (error) {
    if (file?.path) {
      try {
        fs.unlinkSync(file.path);
      } catch (_) {
        /* ignore cleanup errors */
      }
    }
    console.error('Error Sending Mail:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  getAll,
  create,
  update,
  getById,
  cancleOrder,
  deleteOrder,
  sendInvoiceEmail,
  downloadOrderInvoice,
  getCustomerOrder,
  getCustomerOrderDetails,
  cancleService,
  serviceUpdate,
};