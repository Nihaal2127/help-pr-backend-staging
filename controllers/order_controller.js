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
const { getOrderId } = require('../helper/id_generator');
const { checkObjectIdExists } = require('../validator/id_validator');
const {
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_IN_PROGRESS,
  ORDER_STATUS_REFUNDED,
  ORDER_STATUSES,
  normalizeOrderStatus,
  buildOrderStatusQueryFilter,
  getOrderStatusLabel,
  touchOrderStatusInfo,
} = require('../enum/order_status_enum');
const { sendPushNotification } = require('../service/firebase/push_service');
const { generatePaymentLink } = require('./razorpay_controller');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const OrderAdditionalCharge = require('../models/order_additional_charge');
const OrderPayment = require('../models/order_payment');
const OrderOffer = require('../models/order_offer');
const Quote = require('../models/quote');
const { computeOrderTotal, recalculateOrderTotals } = require('../utils/order_financials');
const { isValidOrderPaymentStatus } = require('../enum/order_payment_status_enum');
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
const {
  applyOrderFieldsAndServicesUpdate,
} = require('../services/order_field_update_service');
const {
  resolveOrderListScope,
  assertOrderRecordAccess,
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
  return {
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
  };
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
  return shapeOrderDetailResponse(populatedOrderData, additional_charges, order_payments, order_offer);
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

const resolveOrderSortField = (sortBy) => {
  const sb = String(sortBy || '').trim();
  return ORDER_SORT_WHITELIST.has(sb) ? sb : 'created_at';
};

const resolveOrderSortDir = (req) => {
  const so = String(req.query.sort_order || '').toLowerCase();
  if (so === 'asc') return 1;
  if (so === 'desc') return -1;
  if (req.query.sort !== undefined) {
    const s = parseInt(req.query.sort, 10);
    return s === 1 ? 1 : -1;
  }
  return -1;
};

const parseOrderFilterDate = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
};

const startOfUtcDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const endOfUtcDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

/**
 * getAll query from_date / to_date — schedule overlap and order_date fallback.
 * Works with only from_date, only to_date, or both (open-ended bounds when one is omitted).
 */
const buildOrderDateRangeFilter = (query) => {
  const hasFrom =
    query.from_date !== undefined &&
    query.from_date !== null &&
    String(query.from_date).trim() !== '';
  const hasTo =
    query.to_date !== undefined &&
    query.to_date !== null &&
    String(query.to_date).trim() !== '';

  if (!hasFrom && !hasTo) {
    return { ok: true, filter: {} };
  }

  const parsedFrom = hasFrom ? parseOrderFilterDate(query.from_date) : null;
  const parsedTo = hasTo ? parseOrderFilterDate(query.to_date) : null;

  if (hasFrom && !parsedFrom) {
    return { ok: false, message: 'Invalid from_date filter.' };
  }
  if (hasTo && !parsedTo) {
    return { ok: false, message: 'Invalid to_date filter.' };
  }

  let rangeFrom = parsedFrom ? startOfUtcDay(parsedFrom) : null;
  let rangeTo = parsedTo ? endOfUtcDay(parsedTo) : null;

  // Only one query param → filter that calendar day (from_date or to_date alone).
  if (hasFrom && !hasTo && parsedFrom) {
    rangeTo = endOfUtcDay(parsedFrom);
  } else if (!hasFrom && hasTo && parsedTo) {
    rangeFrom = startOfUtcDay(parsedTo);
  }

  if (rangeFrom && rangeTo && rangeTo < rangeFrom) {
    return {
      ok: false,
      message: 'to_date filter must be on or after from_date filter.',
    };
  }

  const branches = [
    {
      from_date: { $ne: null, $lte: rangeTo },
      to_date: { $ne: null, $gte: rangeFrom },
    },
    {
      $and: [
        { from_date: { $ne: null, $gte: rangeFrom, $lte: rangeTo } },
        { $or: [{ to_date: null }, { to_date: { $exists: false } }] },
      ],
    },
    {
      $and: [
        { to_date: { $ne: null, $gte: rangeFrom, $lte: rangeTo } },
        { $or: [{ from_date: null }, { from_date: { $exists: false } }] },
      ],
    },
    { order_date: { $gte: rangeFrom, $lte: rangeTo } },
  ];

  return { ok: true, filter: { $or: branches } };
};

const resolveOrderListStatusFilter = (orderStatusParam) => {
  if (orderStatusParam === undefined || orderStatusParam === null) {
    return { ok: true, filter: {} };
  }

  const raw = String(orderStatusParam).trim();
  if (raw === '') {
    return { ok: true, filter: {} };
  }

  const statusFilter = buildOrderStatusQueryFilter(raw);
  if (!statusFilter) {
    return {
      ok: false,
      message: `Invalid order_status. Use one of: ${ORDER_STATUSES.join(', ')}.`,
    };
  }

  return { ok: true, filter: statusFilter };
};

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

    const payment_status_raw =
      req.query.payment_status !== undefined &&
      req.query.payment_status !== null &&
      String(req.query.payment_status).trim() !== ''
        ? String(req.query.payment_status).trim().toLowerCase()
        : null;

    if (payment_status_raw && !isValidOrderPaymentStatus(payment_status_raw)) {
      return res.status(409).json({
        success: false,
        status: 409,
        message:
          'Invalid payment_status. Use: unpaid, paid, partially_paid, refund, partially_refund.',
      });
    }

    const rawSearch = req.query.search;
    const legacyKeyword =
      req.query.keyword !== undefined &&
      req.query.keyword !== null &&
      String(req.query.keyword).trim() !== ''
        ? String(req.query.keyword).trim()
        : '';
    const searchTerm =
      rawSearch !== undefined &&
      rawSearch !== null &&
      String(rawSearch).trim() !== ''
        ? sanitizeInput(String(rawSearch).trim())
        : legacyKeyword
          ? sanitizeInput(legacyKeyword)
          : '';
    const regex = searchTerm ? new RegExp(searchTerm, 'i') : null;

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
      ...(payment_status_raw && { payment_status: payment_status_raw }),
      ...(req.query.user_id &&
        mongoose.Types.ObjectId.isValid(req.query.user_id) && {
          user_id: new mongoose.Types.ObjectId(req.query.user_id),
        }),
      ...(req.query.partner_id &&
        mongoose.Types.ObjectId.isValid(req.query.partner_id) && {
          partner_id: new mongoose.Types.ObjectId(req.query.partner_id),
        }),
      ...(req.query.employee_id &&
        mongoose.Types.ObjectId.isValid(req.query.employee_id) && {
          employee_id: new mongoose.Types.ObjectId(req.query.employee_id),
        }),
      ...(req.query.city_id &&
        mongoose.Types.ObjectId.isValid(req.query.city_id) && {
          city_id: new mongoose.Types.ObjectId(req.query.city_id),
        }),
      ...(req.query.category_id &&
        mongoose.Types.ObjectId.isValid(req.query.category_id) && {
          category_id: new mongoose.Types.ObjectId(req.query.category_id),
        }),
      ...(req.query.service_id &&
        mongoose.Types.ObjectId.isValid(req.query.service_id) && {
          service_id: new mongoose.Types.ObjectId(req.query.service_id),
        }),
    };

    const sortField = resolveOrderSortField(req.query.sort_by);
    const sortDir = resolveOrderSortDir(req);
    const sortStage = { [sortField]: sortDir };

    const usersColl = User.collection.name;
    const categoriesColl = Category.collection.name;
    const servicesColl = Service.collection.name;
    const citiesColl = City.collection.name;
    const franchiseColl = Franchise.collection.name;
    const quotesColl = Quote.collection.name;
    const addressColl = Address.collection.name;
    const statesColl = State.collection.name;

    const pipeline = [
      { $match: baseFilter },
      {
        $lookup: {
          from: usersColl,
          localField: 'user_id',
          foreignField: '_id',
          as: '_user',
        },
      },
      {
        $lookup: {
          from: usersColl,
          localField: 'partner_id',
          foreignField: '_id',
          as: '_partner',
        },
      },
      {
        $lookup: {
          from: usersColl,
          localField: 'employee_id',
          foreignField: '_id',
          as: '_employee',
        },
      },
      {
        $lookup: {
          from: usersColl,
          localField: 'created_by_id',
          foreignField: '_id',
          as: '_created_by',
        },
      },
      {
        $lookup: {
          from: categoriesColl,
          localField: 'category_id',
          foreignField: '_id',
          as: '_category',
        },
      },
      {
        $lookup: {
          from: servicesColl,
          localField: 'service_id',
          foreignField: '_id',
          as: '_service',
        },
      },
      {
        $lookup: {
          from: citiesColl,
          localField: 'city_id',
          foreignField: '_id',
          as: '_city',
        },
      },
      {
        $lookup: {
          from: franchiseColl,
          localField: 'franchise_id',
          foreignField: '_id',
          as: '_franchise',
        },
      },
      {
        $lookup: {
          from: addressColl,
          localField: 'address_id',
          foreignField: '_id',
          as: '_address',
        },
      },
      { $unwind: { path: '$_user', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$_partner', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$_employee', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$_created_by', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$_category', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$_service', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$_city', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$_franchise', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$_address', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: citiesColl,
          localField: '_address.city_id',
          foreignField: '_id',
          as: '_addr_city',
        },
      },
      {
        $lookup: {
          from: statesColl,
          localField: '_address.state_id',
          foreignField: '_id',
          as: '_addr_state',
        },
      },
      { $unwind: { path: '$_addr_city', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$_addr_state', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: quotesColl,
          localField: 'quote_id',
          foreignField: '_id',
          as: '_quote',
        },
      },
      { $unwind: { path: '$_quote', preserveNullAndEmptyArrays: true } },
      ...(regex
        ? [
            {
              $match: {
                $or: [
                  { unique_id: regex },
                  { user_unique_id: regex },
                  { address: regex },
                  { comments: regex },
                  { transaction_id: regex },
                  { payment_mode_id: regex },
                  { discount_code: regex },
                  { customer_description: regex },
                  { order_description: regex },
                  { '_quote.quote_sequence_id': regex },
                  { '_quote.quote_description': regex },
                  { '_user.name': regex },
                  { '_user.user_id': regex },
                  { '_user.email': regex },
                  { '_user.phone_number': regex },
                  { '_partner.name': regex },
                  { '_partner.user_id': regex },
                  { '_partner.email': regex },
                  { '_partner.phone_number': regex },
                  { '_employee.name': regex },
                  { '_employee.user_id': regex },
                  { '_created_by.name': regex },
                  { '_created_by.user_id': regex },
                  { '_category.name': regex },
                  { '_category.category_id': regex },
                  { '_service.name': regex },
                  { '_service.service_id': regex },
                  { '_city.name': regex },
                  { '_franchise.name': regex },
                ],
              },
            },
          ]
        : []),
      { $sort: sortStage },
      {
        $addFields: {
          user_name: '$_user.name',
          user_unique_id: '$_user.user_id',
          partner_name: '$_partner.name',
          partner_unique_id: '$_partner.user_id',
          employee_name: '$_employee.name',
          category_name: '$_category.name',
          service_name: '$_service.name',
          city_name: { $ifNull: ['$_city.name', ''] },
          user_id: {
            $cond: [
              { $ifNull: ['$_user._id', false] },
              {
                _id: '$_user._id',
                name: '$_user.name',
                user_id: '$_user.user_id',
                email: '$_user.email',
                phone_number: '$_user.phone_number',
                profile_url: '$_user.profile_url',
                type: '$_user.type',
              },
              null,
            ],
          },
          partner_id: {
            $cond: [
              { $ifNull: ['$_partner._id', false] },
              {
                _id: '$_partner._id',
                name: '$_partner.name',
                user_id: '$_partner.user_id',
                email: '$_partner.email',
                phone_number: '$_partner.phone_number',
                profile_url: '$_partner.profile_url',
                type: '$_partner.type',
              },
              null,
            ],
          },
          employee_id: {
            $cond: [
              { $ifNull: ['$_employee._id', false] },
              {
                _id: '$_employee._id',
                name: '$_employee.name',
                user_id: '$_employee.user_id',
                email: '$_employee.email',
                phone_number: '$_employee.phone_number',
                profile_url: '$_employee.profile_url',
                type: '$_employee.type',
              },
              null,
            ],
          },
          created_by_id: {
            $cond: [
              { $ifNull: ['$_created_by._id', false] },
              {
                _id: '$_created_by._id',
                name: '$_created_by.name',
                user_id: '$_created_by.user_id',
                email: '$_created_by.email',
                phone_number: '$_created_by.phone_number',
                profile_url: '$_created_by.profile_url',
                type: '$_created_by.type',
              },
              null,
            ],
          },
          category_id: {
            $cond: [
              { $ifNull: ['$_category._id', false] },
              {
                _id: '$_category._id',
                name: '$_category.name',
                category_id: '$_category.category_id',
                desc: '$_category.desc',
                image_url: '$_category.image_url',
                approval_status: '$_category.approval_status',
                is_request: '$_category.is_request',
                is_active: '$_category.is_active',
                rejection_reason: '$_category.rejection_reason',
              },
              null,
            ],
          },
          service_id: {
            $cond: [
              { $ifNull: ['$_service._id', false] },
              {
                _id: '$_service._id',
                name: '$_service.name',
                service_id: '$_service.service_id',
                desc: '$_service.desc',
                image_url: '$_service.image_url',
                price: '$_service.price',
                approval_status: '$_service.approval_status',
                is_request: '$_service.is_request',
                is_active: '$_service.is_active',
                rejection_reason: '$_service.rejection_reason',
              },
              null,
            ],
          },
          franchise_id: {
            $cond: [
              { $ifNull: ['$_franchise._id', false] },
              {
                _id: '$_franchise._id',
                name: '$_franchise.name',
                city_name: '$_franchise.city_name',
                state_name: '$_franchise.state_name',
              },
              null,
            ],
          },
          city_id: {
            $cond: [
              { $ifNull: ['$_city._id', false] },
              { _id: '$_city._id', name: '$_city.name' },
              null,
            ],
          },
          address_id: {
            $cond: [
              { $ifNull: ['$_address._id', false] },
              {
                $mergeObjects: [
                  '$_address',
                  {
                    city_id: {
                      $cond: [
                        { $ifNull: ['$_addr_city._id', false] },
                        { _id: '$_addr_city._id', name: '$_addr_city.name' },
                        '$_address.city_id',
                      ],
                    },
                    state_id: {
                      $cond: [
                        { $ifNull: ['$_addr_state._id', false] },
                        { _id: '$_addr_state._id', name: '$_addr_state.name' },
                        '$_address.state_id',
                      ],
                    },
                  },
                ],
              },
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
      },
      {
        $project: {
          _user: 0,
          _partner: 0,
          _employee: 0,
          _created_by: 0,
          _category: 0,
          _service: 0,
          _city: 0,
          _franchise: 0,
          _address: 0,
          _addr_city: 0,
          _addr_state: 0,
          _quote: 0,
        },
      },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'totalCount' }],
        },
      },
    ];

    const agg = Order.aggregate(pipeline).collation({
      locale: 'en',
      strength: 2,
    });

    const result = await agg.exec();
    const facet = result[0] || { data: [], totalCount: [] };
    const orders = facet.data || [];
    const totalCount =
      facet.totalCount && facet.totalCount[0] ? facet.totalCount[0].totalCount : 0;
    const totalPages = Math.ceil(totalCount / limit) || 0;

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Order list fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage: page,
      records: orders,
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
      records: orders,
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

    let draft;
    try {
      draft = await createOrderFromBody(req.body, { linkQuote: true });
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
        message: "Invalid user_id on service_items.",
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

    if (order_status !== undefined) {
      const nextStatus = normalizeOrderStatus(order_status);
      if (!nextStatus) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: `Invalid order_status. Use one of: ${ORDER_STATUSES.join(', ')}.`,
        });
      }
      if (nextStatus !== orderToUpdate.order_status) {
        touchOrderStatusInfo(orderToUpdate, nextStatus);
        orderToUpdate.order_status = nextStatus;
        updateData.service_status = nextStatus;
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
      record: updatedOrder,
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
        message: `Invalid service_status. Use one of: ${ORDER_STATUSES.join(', ')}.`,
      });
    }
    updateData.service_status = normalized;
  }

  try {
    const service = await OrderService.findById(id);

    if (!service) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Order Service  not found'
      });
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
      record: updatedService,
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
      record: updatedOrder,
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
    order.order_status = ORDER_STATUS_CANCELLED;
    order.cancellation_reasone = cancellation_reasone || '';
    touchOrderStatusInfo(order, ORDER_STATUS_CANCELLED);
    const updatedOrder = await order.save();

    await OrderService.updateMany(
      { _id: { $in: order.service_items } },
      {
        $set: {
          service_status: ORDER_STATUS_CANCELLED,
          cancellation_reasone: cancellation_reasone || ''
        }
      }
    );

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
      record: updatedOrder,
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

const sendInvoiceEmail = async (req, res) => {
  const {
    email,
    html_content,
  } = req.body;

  const file = req.file;
  console.log(file);
  try {

    if (!file) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'No images uploaded.'
      });
    }
    const attachments = [
      {
        filename: 'invoice.pdf',
        path: file.path,
      },
    ]
    await sendTemplateEmail(email, 'SOS Order Invoice', html_content, 'Please find your invoice attached.', attachments);
    // await sendTemplateEmail('ishu624746@gmail.com','SOS Order Invoice',html_content,'Please find your invoice attached.',attachments);

    if (file && file.path) {
      fs.unlinkSync(file.path);
    } else {
      console.error("File path is undefined");
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Invoice sent successfully!',
    });
  } catch (error) {
    console.error('Error Sending Mail:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

module.exports = { getAll, create, update, getById, cancleOrder, deleteOrder, sendInvoiceEmail, getCustomerOrder, getCustomerOrderDetails, cancleService, serviceUpdate };