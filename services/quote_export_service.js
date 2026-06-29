const mongoose = require('mongoose');
const Quote = require('../models/quote');
const User = require('../models/user');
const Service = require('../models/service');
const Category = require('../models/category');
const City = require('../models/city');
const Address = require('../models/address');
const Area = require('../models/area');
const Franchise = require('../models/franchise');
const Order = require('../models/order');
const State = require('../models/state');
const { fieldLabel } = require('../utils/field_labels');
const { pickFranchiseIdFromReq } = require('../utils/franchise_access');
const { resolveQuoteListScope } = require('../utils/quote_access');
const { buildQuoteDateRangeFilter } = require('../utils/schedule_date_filters');
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
  QUOTE_DASHBOARD_BUCKETS,
  QUOTE_STATUSES,
  buildQuoteBucketFilter,
  resolveQuoteStatus,
  formatQuoteRecords,
} = require('../enum/quote_status_enum');

const QUOTE_EXPORT_SORT_WHITELIST = new Set([
  'created_at',
  'updated_at',
  'from_date',
  'to_date',
  'total_service_charge',
  'service_price',
  'total_price',
  'status',
  'quote_sequence_id',
]);

const QUOTE_EXPORT_SEARCH_FIELDS = [
  'quote_sequence_id',
  'quote_description',
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
  '_service.name',
  '_service.rejection_reason',
  '_category.rejection_reason',
  '_franchise.name',
];

const QUOTE_EXPORT_HEADERS = [
  'Quote ID',
  'Quote Status',
  'From Date',
  'To Date',
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
  'Service Charge',
  'Sub Total',
  'Tax',
  'Total Price',
  'Min Deposit',
  'Order ID',
  'Work Hours Per Day',
  'Total Work Hours',
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

const resolveQuoteExportStatusFilter = (statusParam) =>
  resolveListStatusFilter(statusParam, {
    buildFilter: (raw) => {
      const bucketKey = raw.toLowerCase();
      if (bucketKey === 'fail') {
        return buildQuoteBucketFilter('failed');
      }
      if (QUOTE_DASHBOARD_BUCKETS.includes(bucketKey)) {
        return buildQuoteBucketFilter(bucketKey);
      }
      return null;
    },
    invalidMessage: `Invalid ${fieldLabel('quote_status')}. Use one of: ${QUOTE_STATUSES.join(', ')}.`,
  });

const buildQuoteGeoLocationFilter = async (params) => {
  const idValidation = validateOptionalObjectIdParams(params, [
    'state_id',
    'city_id',
    'area_id',
  ]);
  if (!idValidation.ok) {
    return { ok: false, message: idValidation.message };
  }

  const stateIdRaw = pickParam(params, 'state_id');
  const cityIdRaw = pickParam(params, 'city_id');
  const areaIdRaw = pickParam(params, 'area_id');
  const clauses = [];

  if (cityIdRaw && mongoose.Types.ObjectId.isValid(cityIdRaw)) {
    const cityOid = new mongoose.Types.ObjectId(cityIdRaw);
    const addressIds = await Address.find({
      city_id: cityOid,
      deleted_at: null,
    }).distinct('_id');
    clauses.push({ address_id: { $in: addressIds } });
  }

  if (stateIdRaw && mongoose.Types.ObjectId.isValid(stateIdRaw)) {
    const stateOid = new mongoose.Types.ObjectId(stateIdRaw);
    const [cityIds, addressIdsByState] = await Promise.all([
      City.find({ state_id: stateOid, deleted_at: null }).distinct('_id'),
      Address.find({ state_id: stateOid, deleted_at: null }).distinct('_id'),
    ]);
    const addressIdsByCity = cityIds.length
      ? await Address.find({
          city_id: { $in: cityIds },
          deleted_at: null,
        }).distinct('_id')
      : [];
    const merged = new Set([
      ...addressIdsByState.map(String),
      ...addressIdsByCity.map(String),
    ]);
    clauses.push({
      address_id: {
        $in: [...merged].map((id) => new mongoose.Types.ObjectId(id)),
      },
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

const pickRefName = (ref) => {
  if (!ref || typeof ref !== 'object') return '';
  return ref.name || '';
};

const pickUserDisplayId = (ref) => {
  if (!ref || typeof ref !== 'object') return '';
  return ref.user_id || '';
};

const mapQuoteToExportRow = (quote) => {
  const address =
    quote.address_id && typeof quote.address_id === 'object' ? quote.address_id : null;
  const order =
    quote.order_id && typeof quote.order_id === 'object' ? quote.order_id : null;

  return {
    quote_id: quote.quote_sequence_id || '',
    quote_status: titleCaseStatus(resolveQuoteStatus(quote)),
    from_date: formatDateOnly(quote.from_date) || '',
    to_date: formatDateOnly(quote.to_date) || '',
    customer_name: pickRefName(quote.user_id),
    customer_id: pickUserDisplayId(quote.user_id),
    partner_name: pickRefName(quote.partner_id),
    partner_id: pickUserDisplayId(quote.partner_id),
    category: pickRefName(quote.category_id),
    service: pickRefName(quote.service_id),
    state: pickRefName(address?.state_id),
    city: pickRefName(address?.city_id) || address?.city || '',
    area: pickRefName(address?.area_id) || address?.area || '',
    franchise: pickRefName(quote.franchise_id),
    address: address?.address || '',
    service_charge: quote.total_service_charge ?? quote.service_price ?? '',
    sub_total: quote.sub_total ?? '',
    tax: quote.tax_amount ?? '',
    total_price: quote.total_price ?? '',
    min_deposit: quote.minimum_deposit_amount ?? '',
    order_id: order?.unique_id || '',
    work_hours_per_day: quote.work_hours_per_day ?? '',
    total_work_hours: quote.total_work_hours ?? '',
    admin_description: quote.admin_description ?? '',
    created_at: formatDateOnly(quote.created_at) || '',
  };
};

const buildQuoteExportBaseFilter = async (req) => {
  const params = mergeExportParams(req);
  const franchiseIdFromQuery = pickFranchiseIdFromReq(req);

  const scopeResult = await resolveQuoteListScope(req, {
    franchiseIdFromQuery,
  });
  if (!scopeResult.ok) {
    return scopeResult;
  }

  const statusFilterResult = resolveQuoteExportStatusFilter(
    pickParam(params, 'quote_status', 'status')
  );
  if (!statusFilterResult.ok) {
    return { ok: false, status: 409, message: statusFilterResult.message };
  }

  const dateRangeResult = buildQuoteDateRangeFilter(params);
  if (!dateRangeResult.ok) {
    return { ok: false, status: 409, message: dateRangeResult.message };
  }

  const geoFilterResult = await buildQuoteGeoLocationFilter(params);
  if (!geoFilterResult.ok) {
    return { ok: false, status: 409, message: geoFilterResult.message };
  }

  const objectIdValidation = validateOptionalObjectIdParams(params, [
    'user_id',
    'partner_id',
    'employee_id',
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
    'category_id',
    'service_id',
  ]);

  const baseFilter = {
    deleted_at: null,
    ...scopeResult.filter,
    ...dateRangeResult.filter,
    ...statusFilterResult.filter,
    ...geoFilterResult.filter,
    ...objectIdFilters,
  };

  return { ok: true, baseFilter, params };
};

const fetchQuotesForExport = async (req) => {
  const filterResult = await buildQuoteExportBaseFilter(req);
  if (!filterResult.ok) {
    return filterResult;
  }

  const { baseFilter, params } = filterResult;
  const sortField = resolveSortField(
    pickParam(params, 'sort_by'),
    QUOTE_EXPORT_SORT_WHITELIST
  );
  const sortDir = resolveSortDir({ query: params });
  const sortStage = { [sortField]: sortDir };
  const regex = resolveListSearchRegex({ query: params });

  const collections = getListCollectionNames({
    users: User,
    categories: Category,
    services: Service,
    franchise: Franchise,
    address: Address,
    cities: City,
    states: State,
    areas: Area,
    orders: Order,
  });

  const pipeline = buildEntityExportPipeline({
    baseFilter,
    sortStage,
    regex,
    searchFields: QUOTE_EXPORT_SEARCH_FIELDS,
    collections,
    includeAreaOnAddress: true,
    includeOrderLookup: true,
    extraProject: { history: 0 },
  });

  pipeline.push({ $limit: MAX_EXPORT_ROWS + 1 });

  const quotes = await Quote.aggregate(pipeline)
    .collation({ locale: 'en', strength: 2 })
    .exec();

  if (quotes.length > MAX_EXPORT_ROWS) {
    return {
      ok: false,
      status: 409,
      message: `Export limit exceeded (${MAX_EXPORT_ROWS} rows). Narrow your filters and try again.`,
    };
  }

  const formatted = formatQuoteRecords(quotes);

  return {
    ok: true,
    rows: formatted.map(mapQuoteToExportRow),
    rowCount: formatted.length,
  };
};

module.exports = {
  QUOTE_EXPORT_HEADERS,
  mergeExportParams,
  buildQuoteExportBaseFilter,
  fetchQuotesForExport,
  mapQuoteToExportRow,
};
