const mongoose = require('mongoose');
const Order = require('../models/order');
const Quote = require('../models/quote');
const User = require('../models/user');
const Service = require('../models/service');
const Category = require('../models/category');
const City = require('../models/city');
const State = require('../models/state');
const Address = require('../models/address');
const Area = require('../models/area');
const Franchise = require('../models/franchise');
const OrderService = require('../models/order_services');
const { parseBoolean } = require('../utils/parser');
const { fieldLabel } = require('../utils/field_labels');
const { pickFranchiseIdFromReq } = require('../utils/franchise_access');
const { resolveOrderListScope } = require('../utils/order_access');
const { buildOrderDateRangeFilter } = require('../utils/schedule_date_filters');
const {
  resolveListStatusFilter,
  resolveListSearchRegex,
  resolveSortField,
  resolveSortDir,
} = require('../utils/list_query_helpers');
const { buildObjectIdQueryFilters } = require('../utils/mongoose_helpers');
const { validateOptionalObjectIdParams } = require('../utils/export_filter_helpers');
const {
  buildEntityExportPipeline,
  getListCollectionNames,
} = require('../utils/list_aggregation');
const { formatDateOnly } = require('../utils/dateFormatter');
const {
  ORDER_STATUSES,
  buildOrderStatusQueryFilter,
  getOrderStatusLabel,
} = require('../enum/order_status_enum');
const {
  QUOTE_STATUSES,
  buildQuoteBucketFilter,
  resolveQuoteStatus,
} = require('../enum/quote_status_enum');
const {
  isValidOrderPaymentStatus,
  isValidPartnerPaymentStatus,
} = require('../enum/order_payment_status_enum');

const ORDER_EXPORT_SORT_WHITELIST = new Set([
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

const ORDER_EXPORT_SEARCH_FIELDS = [
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

const ORDER_EXPORT_HEADERS = [
  'Order ID',
  'Order Status',
  'Order Date',
  'From Date',
  'To Date',
  'Quote ID',
  'Quote Status',
  'Customer Name',
  'Customer ID',
  'Partner Name',
  'Partner ID',
  'Category',
  'Service',
  'State',
  'City',
  'Area',
  'Franchise',
  'Address',
  'Sub Total',
  'Tax',
  'Total Price',
  'Customer Payment Status',
  'Partner Payment Status',
  'Customer Paid',
  'Partner Paid',
  'Payment Mode',
  'Admin Description',
  'Created At',
];

const MAX_EXPORT_ROWS = 50000;

const mergeExportParams = (req) => ({
  ...(req.query || {}),
  ...(req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {}),
});

const pickParam = (params, ...keys) => {
  for (const key of keys) {
    const raw = params[key];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      return raw;
    }
  }
  return null;
};

const titleCaseStatus = (value) => {
  if (!value) return '';
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const resolveOrderExportStatusFilter = (orderStatusParam) =>
  resolveListStatusFilter(orderStatusParam, {
    buildFilter: (raw) => buildOrderStatusQueryFilter(raw),
    invalidMessage: `Invalid ${fieldLabel('order_status')}. Use one of: ${ORDER_STATUSES.join(', ')}.`,
  });

const resolveQuoteExportStatusFilter = (quoteStatusParam) => {
  if (quoteStatusParam === undefined || quoteStatusParam === null) {
    return { ok: true, filter: null };
  }
  const raw = String(quoteStatusParam).trim();
  if (raw === '') {
    return { ok: true, filter: null };
  }
  const bucket = raw === 'fail' ? 'failed' : raw.toLowerCase();
  const filter = buildQuoteBucketFilter(bucket);
  if (!filter) {
    return {
      ok: false,
      message: `Invalid ${fieldLabel('quote_status')}. Use one of: ${QUOTE_STATUSES.join(', ')}.`,
    };
  }
  return { ok: true, filter };
};

const buildGeoLocationFilter = async (params) => {
  const stateIdRaw = pickParam(params, 'state_id');
  const areaIdRaw = pickParam(params, 'area_id');

  const idValidation = validateOptionalObjectIdParams(params, ['state_id', 'area_id', 'city_id']);
  if (!idValidation.ok) {
    return { ok: false, message: idValidation.message };
  }

  const clauses = [];

  if (stateIdRaw && mongoose.Types.ObjectId.isValid(stateIdRaw)) {
    const stateOid = new mongoose.Types.ObjectId(stateIdRaw);
    const [cityIds, addressIds] = await Promise.all([
      City.find({ state_id: stateOid, deleted_at: null }).distinct('_id'),
      Address.find({ state_id: stateOid, deleted_at: null }).distinct('_id'),
    ]);
    clauses.push({
      $or: [
        { city_id: { $in: cityIds } },
        { address_id: { $in: addressIds } },
      ],
    });
  }

  if (areaIdRaw && mongoose.Types.ObjectId.isValid(areaIdRaw)) {
    const areaOid = new mongoose.Types.ObjectId(areaIdRaw);
    const addressIds = await Address.find({
      area_id: areaOid,
      deleted_at: null,
    }).distinct('_id');
    clauses.push({ address_id: { $in: addressIds } });
  }

  if (!clauses.length) {
    return { ok: true, filter: {} };
  }
  if (clauses.length === 1) {
    return { ok: true, filter: clauses[0] };
  }
  return { ok: true, filter: { $and: clauses } };
};

const resolvePaymentStatusParam = (params) => {
  const raw = pickParam(
    params,
    'customer_payment_status',
    'user_payment_status',
    'payment_status'
  );
  if (!raw) return null;
  return String(raw).trim().toLowerCase();
};

const resolvePartnerPaymentStatusParam = (params) => {
  const raw = pickParam(params, 'partner_payment_status');
  if (!raw) return null;
  return String(raw).trim().toLowerCase();
};

const resolvePaymentModeLabel = (order) => {
  const method = String(order.customer_payment_method || '').trim();
  if (method) return titleCaseStatus(method);
  return String(order.payment_mode_id) === '2' ? 'Online' : 'COD';
};

const pickRefName = (ref) => {
  if (!ref || typeof ref !== 'object') return '';
  return ref.name || '';
};

const pickUserDisplayId = (ref) => {
  if (!ref || typeof ref !== 'object') return '';
  return ref.user_id || '';
};

const mapOrderToExportRow = (order) => {
  const quote = order.quote_id && typeof order.quote_id === 'object' ? order.quote_id : null;
  const address = order.address_id && typeof order.address_id === 'object' ? order.address_id : null;

  return {
    order_id: order.unique_id || '',
    order_status: getOrderStatusLabel(order.order_status) || order.order_status || '',
    order_date: formatDateOnly(order.order_date) || '',
    from_date: formatDateOnly(order.from_date) || '',
    to_date: formatDateOnly(order.to_date) || '',
    quote_id: quote?.quote_sequence_id || '',
    quote_status: quote ? titleCaseStatus(resolveQuoteStatus(quote)) : '',
    customer_name: pickRefName(order.user_id),
    customer_id: pickUserDisplayId(order.user_id) || order.user_unique_id || '',
    partner_name: pickRefName(order.partner_id),
    partner_id: pickUserDisplayId(order.partner_id),
    category: pickRefName(order.category_id),
    service: pickRefName(order.service_id),
    state: pickRefName(address?.state_id),
    city: order.city_name || pickRefName(address?.city_id) || pickRefName(order.city_id),
    area: pickRefName(address?.area_id) || address?.area || '',
    franchise: pickRefName(order.franchise_id),
    address: order.address || address?.address || '',
    sub_total: order.sub_total ?? '',
    tax: order.tax_amount ?? order.tax ?? '',
    total_price: order.total_price ?? '',
    customer_payment_status: titleCaseStatus(
      order.user_payment_status || order.payment_status || ''
    ),
    partner_payment_status: titleCaseStatus(order.partner_payment_status || ''),
    customer_paid: order.customer_net_paid ?? order.customer_paid_amount ?? '',
    partner_paid: order.partner_paid_amount ?? '',
    payment_mode: resolvePaymentModeLabel(order),
    admin_description: order.admin_description ?? '',
    created_at: formatDateOnly(order.created_at) || '',
  };
};

const buildOrderExportBaseFilter = async (req) => {
  const params = mergeExportParams(req);
  const franchiseIdFromQuery = pickFranchiseIdFromReq(req);

  const scopeResult = await resolveOrderListScope(req, {
    franchiseIdFromQuery,
  });
  if (!scopeResult.ok) {
    return scopeResult;
  }

  const statusFilterResult = resolveOrderExportStatusFilter(
    pickParam(params, 'order_status')
  );
  if (!statusFilterResult.ok) {
    return { ok: false, status: 409, message: statusFilterResult.message };
  }

  const quoteStatusFilterResult = await (async () => {
    const result = resolveQuoteExportStatusFilter(
      pickParam(params, 'quote_status', 'status')
    );
    if (!result.ok) {
      return { ok: false, status: 409, message: result.message };
    }
    if (!result.filter) {
      return { ok: true, filter: {} };
    }
    const quoteIds = await Quote.find({
      deleted_at: null,
      ...result.filter,
    }).distinct('_id');
    return { ok: true, filter: { quote_id: { $in: quoteIds } } };
  })();
  if (!quoteStatusFilterResult.ok) {
    return quoteStatusFilterResult;
  }

  const isPaidRaw = pickParam(params, 'is_paid');
  const isPaid =
    isPaidRaw !== null && isPaidRaw !== undefined && String(isPaidRaw).trim() !== ''
      ? parseBoolean(isPaidRaw)
      : null;

  const paymentStatusRaw = resolvePaymentStatusParam(params);
  if (paymentStatusRaw && !isValidOrderPaymentStatus(paymentStatusRaw)) {
    return {
      ok: false,
      status: 409,
      message: `Invalid ${fieldLabel('customer_payment_status')}. Use: unpaid, paid, partially_paid, refund, partially_refund.`,
    };
  }

  const partnerPaymentStatusRaw = resolvePartnerPaymentStatusParam(params);
  if (
    partnerPaymentStatusRaw &&
    !isValidPartnerPaymentStatus(partnerPaymentStatusRaw)
  ) {
    return {
      ok: false,
      status: 409,
      message: `Invalid ${fieldLabel('partner_payment_status')}. Use: unpaid, partially_paid, paid.`,
    };
  }

  const dateRangeResult = buildOrderDateRangeFilter(params);
  if (!dateRangeResult.ok) {
    return { ok: false, status: 409, message: dateRangeResult.message };
  }

  const geoFilterResult = await buildGeoLocationFilter(params);
  if (!geoFilterResult.ok) {
    return { ok: false, status: 409, message: geoFilterResult.message };
  }

  const objectIdValidation = validateOptionalObjectIdParams(params, [
    'user_id',
    'partner_id',
    'employee_id',
    'city_id',
    'category_id',
    'service_id',
  ]);
  if (!objectIdValidation.ok) {
    return { ok: false, status: 409, message: objectIdValidation.message };
  }

  const objectIdFilters = buildObjectIdQueryFilters(params, [
    'user_id',
    'partner_id',
    'employee_id',
    'city_id',
    'category_id',
    'service_id',
  ]);

  const baseFilter = {
    deleted_at: null,
    ...scopeResult.filter,
    ...dateRangeResult.filter,
    ...statusFilterResult.filter,
    ...quoteStatusFilterResult.filter,
    ...geoFilterResult.filter,
    ...(isPaid !== null && { is_paid: isPaid }),
    ...(paymentStatusRaw && {
      payment_status: paymentStatusRaw,
      user_payment_status: paymentStatusRaw,
    }),
    ...(partnerPaymentStatusRaw && {
      partner_payment_status: partnerPaymentStatusRaw,
    }),
    ...objectIdFilters,
  };

  return { ok: true, baseFilter, params };
};

const fetchOrdersForExport = async (req) => {
  const filterResult = await buildOrderExportBaseFilter(req);
  if (!filterResult.ok) {
    return filterResult;
  }

  const { baseFilter, params } = filterResult;
  const sortField = resolveSortField(
    pickParam(params, 'sort_by'),
    ORDER_EXPORT_SORT_WHITELIST
  );
  const sortDir = resolveSortDir({ query: params });
  const sortStage = { [sortField]: sortDir };

  const regex = resolveListSearchRegex({ query: params }, { legacyKeyword: true });

  const collections = getListCollectionNames({
    users: User,
    categories: Category,
    services: Service,
    cities: City,
    franchise: Franchise,
    quotes: Quote,
    address: Address,
    states: State,
    areas: Area,
    orderServices: OrderService,
  });

  const pipeline = buildEntityExportPipeline({
    baseFilter,
    sortStage,
    regex,
    searchFields: ORDER_EXPORT_SEARCH_FIELDS,
    collections,
    includeRootCityLookup: true,
    includeQuoteLookup: true,
    includeAreaOnAddress: true,
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
            partner_id: '$_quote.partner_id',
            order_id: '$_quote.order_id',
          },
          null,
        ],
      },
    },
  });

  pipeline.push({ $limit: MAX_EXPORT_ROWS + 1 });

  const orders = await Order.aggregate(pipeline)
    .collation({ locale: 'en', strength: 2 })
    .exec();

  if (orders.length > MAX_EXPORT_ROWS) {
    return {
      ok: false,
      status: 409,
      message: `Export limit exceeded (${MAX_EXPORT_ROWS} rows). Narrow your filters and try again.`,
    };
  }

  return {
    ok: true,
    rows: orders.map(mapOrderToExportRow),
    rowCount: orders.length,
  };
};

module.exports = {
  ORDER_EXPORT_HEADERS,
  mergeExportParams,
  buildOrderExportBaseFilter,
  fetchOrdersForExport,
  mapOrderToExportRow,
};
