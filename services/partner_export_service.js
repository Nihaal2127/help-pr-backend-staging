const mongoose = require('mongoose');
const User = require('../models/user');
const PartnerService = require('../models/partner_service');
const OrderService = require('../models/order_services');
const Order = require('../models/order');
const Franchise = require('../models/franchise');
const City = require('../models/city');
const State = require('../models/state');
const Area = require('../models/area');
const { pickFranchiseIdFromReq } = require('../utils/franchise_access');
const { resolvePartnerPayoutListScope } = require('../utils/partner_payout_access');
const { buildScheduleDateRangeCore } = require('../utils/schedule_date_filters');
const { startOfUtcDay, endOfUtcDay } = require('../utils/date_bounds');
const { buildObjectIdQueryFilters } = require('../utils/mongoose_helpers');
const { validateOptionalObjectIdParams } = require('../utils/export_filter_helpers');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const { formatDateOnly } = require('../utils/dateFormatter');
const { getWalletAggregatesForPartners } = require('./partner_payout_service');
const {
  ORDER_STATUS_REFUNDED,
  buildTerminalOrderStatusMatchValues,
} = require('../enum/order_status_enum');

const PARTNER_USER_TYPE = 2;
const MAX_EXPORT_ROWS = 50000;

const PARTNER_EXPORT_HEADERS = [
  'Partner ID',
  'Partner Name',
  'State',
  'City',
  'Area',
  'Franchise',
  'No Of Services',
  'Services Provided',
  'Total Earnings',
  'Wallet Balance',
  'Pending Payout',
  'Average Rating',
  'Status',
  'Joined Date',
];

const TERMINAL_ORDER_STATUS_VALUES = buildTerminalOrderStatusMatchValues();

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

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const resolvePartnerExportDateRange = (params) => {
  const core = buildScheduleDateRangeCore(params);
  if (!core.ok) {
    return { ok: false, message: core.message };
  }
  if (core.noDateParams) {
    return { ok: true, rangeFrom: null, rangeTo: null };
  }

  let rangeFrom = core.rangeFrom ?? null;
  let rangeTo = core.rangeTo ?? null;

  if (core.hasFrom && !core.hasTo && core.parsedFrom) {
    rangeTo = endOfUtcDay(core.parsedFrom);
  } else if (!core.hasFrom && core.hasTo && core.parsedTo) {
    rangeFrom = startOfUtcDay(core.parsedTo);
  }

  if (rangeFrom && rangeTo && rangeTo < rangeFrom) {
    return {
      ok: false,
      message: 'To date filter must be on or after from date filter.',
    };
  }

  return { ok: true, rangeFrom, rangeTo };
};

const buildOrderServiceDateMatch = (rangeFrom, rangeTo) => {
  if (!rangeFrom && !rangeTo) {
    return {};
  }

  const createdAtClause = {};
  if (rangeFrom) createdAtClause.$gte = rangeFrom;
  if (rangeTo) createdAtClause.$lte = rangeTo;

  const serviceDateClause = { ...createdAtClause, $ne: null };

  return {
    $or: [{ service_date: serviceDateClause }, { created_at: createdAtClause }],
  };
};

const buildPartnerServiceLookupStage = ({ categoryOid, serviceOid }) => {
  const extraMatch = {};
  if (categoryOid) extraMatch.category_id = categoryOid;
  if (serviceOid) extraMatch.service_id = serviceOid;

  return {
    $lookup: {
      from: PartnerService.collection.name,
      let: { partnerOid: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ['$partner_id', '$$partnerOid'] },
            deleted_at: null,
            ...extraMatch,
          },
        },
        { $project: { _id: 1 } },
      ],
      as: 'partner_service',
    },
  };
};

const buildOrderServiceLookupStage = ({ rangeFrom, rangeTo, categoryOid, serviceOid }) => {
  const extraMatch = {};
  if (categoryOid) extraMatch.category_id = categoryOid;
  if (serviceOid) extraMatch.service_id = serviceOid;

  return {
    $lookup: {
      from: OrderService.collection.name,
      let: { partnerOid: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ['$partner_id', '$$partnerOid'] },
            deleted_at: null,
            service_status: { $ne: ORDER_STATUS_REFUNDED },
            ...extraMatch,
            ...buildOrderServiceDateMatch(rangeFrom, rangeTo),
          },
        },
        {
          $project: {
            partner_earning: 1,
            rating: 1,
          },
        },
      ],
      as: 'order_service',
    },
  };
};

const buildPartnerExportBaseFilter = async (req) => {
  const params = mergeExportParams(req);
  const franchiseIdFromQuery = pickFranchiseIdFromReq(req);

  const scopeResult = await resolvePartnerPayoutListScope(req, {
    franchiseIdFromQuery,
  });
  if (!scopeResult.ok) {
    return scopeResult;
  }

  const dateRangeResult = resolvePartnerExportDateRange(params);
  if (!dateRangeResult.ok) {
    return { ok: false, status: 409, message: dateRangeResult.message };
  }

  const objectIdValidation = validateOptionalObjectIdParams(params, [
    'state_id',
    'city_id',
    'area_id',
    'partner_id',
    'category_id',
    'service_id',
  ]);
  if (!objectIdValidation.ok) {
    return { ok: false, status: 409, message: objectIdValidation.message };
  }

  const categoryRaw = pickParam(params, 'category_id');
  const serviceRaw = pickParam(params, 'service_id');
  let categoryOid = null;
  let serviceOid = null;

  if (categoryRaw) {
    categoryOid = new mongoose.Types.ObjectId(categoryRaw);
  }

  if (serviceRaw) {
    serviceOid = new mongoose.Types.ObjectId(serviceRaw);
  }

  const partnerMatch = {
    deleted_at: null,
    type: PARTNER_USER_TYPE,
    verification_status: 2,
    ...scopeResult.filter,
    ...buildObjectIdQueryFilters(params, ['state_id', 'city_id', 'area_id']),
  };

  const partnerIdRaw = pickParam(params, 'partner_id');
  if (partnerIdRaw) {
    partnerMatch._id = new mongoose.Types.ObjectId(partnerIdRaw);
  }

  if (categoryOid || serviceOid) {
    const offeringFilter = { deleted_at: null };
    if (categoryOid) offeringFilter.category_id = categoryOid;
    if (serviceOid) offeringFilter.service_id = serviceOid;
    const offeringPartnerIds = await PartnerService.distinct(
      'partner_id',
      offeringFilter
    );
    const existingIdFilter = partnerMatch._id;
    if (existingIdFilter) {
      const allowed = offeringPartnerIds.some(
        (id) => String(id) === String(existingIdFilter)
      );
      if (!allowed) {
        return {
          ok: true,
          baseFilter: { _id: { $in: [] } },
          dateRange: dateRangeResult,
          categoryOid,
          serviceOid,
          params,
        };
      }
    } else {
      partnerMatch._id = { $in: offeringPartnerIds };
    }
  }

  const searchRaw = pickParam(params, 'search', 'keyword');
  if (searchRaw) {
    const pattern = new RegExp(sanitizeInput(searchRaw), 'i');
    partnerMatch.$or = [{ name: pattern }, { user_id: pattern }];
  }

  return {
    ok: true,
    baseFilter: partnerMatch,
    dateRange: dateRangeResult,
    categoryOid,
    serviceOid,
    params,
  };
};

const buildPendingPayoutMap = async (partnerIds, rangeFrom, rangeTo) => {
  if (!partnerIds.length) return new Map();

  const orderMatch = {
    deleted_at: null,
    partner_id: { $in: partnerIds },
    order_status: { $nin: TERMINAL_ORDER_STATUS_VALUES },
  };

  if (rangeFrom || rangeTo) {
    const createdAtClause = {};
    if (rangeFrom) createdAtClause.$gte = rangeFrom;
    if (rangeTo) createdAtClause.$lte = rangeTo;
    orderMatch.created_at = createdAtClause;
  }

  const rows = await Order.aggregate([
    { $match: orderMatch },
    {
      $group: {
        _id: '$partner_id',
        pending_payout: { $sum: { $ifNull: ['$partner_due_amount', 0] } },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [String(row._id), roundMoney(row.pending_payout)])
  );
};

const mapPartnerToExportRow = (partner, wallet, pendingPayout) => ({
  partner_id: partner.partner_id || '',
  partner_name: partner.partner_name || '',
  state: partner.state_name || '',
  city: partner.city_name || '',
  area: partner.area_name || '',
  franchise: partner.franchise_name || '',
  no_of_services: partner.no_of_services ?? 0,
  services_provided: partner.services_provided ?? 0,
  total_earnings: roundMoney(partner.total_earnings),
  wallet_balance: roundMoney(wallet?.total_wallet_amount ?? 0),
  pending_payout: roundMoney(pendingPayout ?? 0),
  average_rating: roundMoney(partner.average_rating),
  status: partner.status || '',
  joined_date: formatDateOnly(partner.joined_date) || '',
});

const fetchPartnersForExport = async (req) => {
  const filterResult = await buildPartnerExportBaseFilter(req);
  if (!filterResult.ok) {
    return filterResult;
  }

  const {
    baseFilter,
    dateRange: { rangeFrom, rangeTo },
    categoryOid,
    serviceOid,
  } = filterResult;

  const pipeline = [
    { $match: baseFilter },
    buildPartnerServiceLookupStage({ categoryOid, serviceOid }),
    buildOrderServiceLookupStage({ rangeFrom, rangeTo, categoryOid, serviceOid }),
    {
      $lookup: {
        from: State.collection.name,
        localField: 'state_id',
        foreignField: '_id',
        as: '_state',
      },
    },
    {
      $lookup: {
        from: City.collection.name,
        localField: 'city_id',
        foreignField: '_id',
        as: '_city',
      },
    },
    {
      $lookup: {
        from: Area.collection.name,
        localField: 'area_id',
        foreignField: '_id',
        as: '_area',
      },
    },
    {
      $lookup: {
        from: Franchise.collection.name,
        localField: 'franchise_id',
        foreignField: '_id',
        as: '_franchise',
      },
    },
    {
      $addFields: {
        no_of_services: { $size: '$partner_service' },
        services_provided: { $size: '$order_service' },
        total_earnings: { $sum: '$order_service.partner_earning' },
        average_rating: {
          $cond: [
            { $gt: [{ $size: '$order_service' }, 0] },
            {
              $avg: {
                $map: {
                  input: {
                    $filter: {
                      input: '$order_service',
                      as: 'line',
                      cond: { $gt: ['$$line.rating', 0] },
                    },
                  },
                  as: 'ratedLine',
                  in: '$$ratedLine.rating',
                },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $project: {
        _id: 1,
        partner_id: '$user_id',
        partner_name: '$name',
        state_name: { $arrayElemAt: ['$_state.name', 0] },
        city_name: { $arrayElemAt: ['$_city.name', 0] },
        area_name: { $arrayElemAt: ['$_area.name', 0] },
        franchise_name: { $arrayElemAt: ['$_franchise.name', 0] },
        no_of_services: 1,
        services_provided: 1,
        total_earnings: 1,
        average_rating: 1,
        joined_date: '$created_at',
        status: {
          $cond: {
            if: { $eq: ['$is_blocked', true] },
            then: 'Blocked',
            else: {
              $cond: {
                if: { $eq: ['$is_active', true] },
                then: 'Active',
                else: 'Inactive',
              },
            },
          },
        },
      },
    },
    { $sort: { partner_name: 1 } },
    { $limit: MAX_EXPORT_ROWS + 1 },
  ];

  const partners = await User.aggregate(pipeline)
    .collation({ locale: 'en', strength: 2 })
    .exec();

  if (partners.length > MAX_EXPORT_ROWS) {
    return {
      ok: false,
      status: 409,
      message: `Export limit exceeded (${MAX_EXPORT_ROWS} rows). Narrow your filters and try again.`,
    };
  }

  const partnerMongoIds = partners.map((row) => row._id).filter(Boolean);
  const walletMap = await getWalletAggregatesForPartners(partnerMongoIds);
  const pendingMap = await buildPendingPayoutMap(
    partnerMongoIds,
    rangeFrom,
    rangeTo
  );

  const rows = partners.map((partner) => {
    const partnerKey = String(partner._id || '');
    return mapPartnerToExportRow(
      partner,
      walletMap.get(partnerKey),
      pendingMap.get(partnerKey)
    );
  });

  return {
    ok: true,
    rows,
    rowCount: rows.length,
  };
};

module.exports = {
  PARTNER_EXPORT_HEADERS,
  mergeExportParams,
  buildPartnerExportBaseFilter,
  fetchPartnersForExport,
  mapPartnerToExportRow,
};
