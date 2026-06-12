const mongoose = require('mongoose');
const { resolveFranchiseEffectiveCatalog } = require('../../../utils/catalog_availability_resolver');
const { PLAN_NAMES } = require('../../../models/subscription_plan');
const CustomerSavedPartner = require('../../../models/customer_saved_partner');
const User = require('../../../models/user');
const OrderService = require('../../../models/order_services');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');
const { ORDER_STATUS_COMPLETED } = require('../../../enum/order_status_enum');
const {
  resolveFranchiseById,
  loadSubscribedFranchisePartners,
  collectEffectivePartnerOfferings,
  mapFranchisePartnerRecords,
  buildPartnerDetailCatalog,
} = require('./franchise_partner_scope');
const {
  enrichPartnerCatalogWithRatings,
  enrichPartnerListRecordsWithServiceRatings,
} = require('./partner_rating_service');
const { attachPartnerRatingFields } = require('../../../utils/rating_format');

const { fail, ok, parsePositiveInt } = require('../../../utils/mobile_service_result');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const parseOptionalPrice = (raw, fieldName) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: true, value: null };
  }
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) {
    return { ok: false, message: `${fieldName} must be a non-negative number.` };
  }
  return { ok: true, value: n };
};

const partnerMatchesSearch = (partner, search) => {
  if (!search) return true;
  return String(partner.name ?? '')
    .toLowerCase()
    .includes(String(search).trim().toLowerCase());
};

const partnerMatchesPlan = (partner, planName) => {
  if (!planName) return true;
  return (
    String(partner.subscription_plan_name ?? '').toLowerCase() ===
    String(planName).trim().toLowerCase()
  );
};

const partnerMatchesCategory = (partner, categoryId) => {
  if (!categoryId) return true;
  const key = String(categoryId);
  return (partner.categories || []).some((c) => String(c._id) === key);
};

const partnerMatchesService = (partner, serviceId) => {
  if (!serviceId) return true;
  const key = String(serviceId);
  return (partner.categories || []).some((c) =>
    (c.services || []).some((s) => String(s._id) === key)
  );
};

const collectPartnerOfferingPrices = (partner, serviceId, categoryId) => {
  const prices = [];
  for (const cat of partner.categories || []) {
    if (categoryId && String(cat._id) !== String(categoryId)) continue;
    for (const svc of cat.services || []) {
      if (serviceId && String(svc._id) !== String(serviceId)) continue;
      const price = Number(svc.price);
      if (!Number.isNaN(price)) prices.push(price);
    }
  }
  return prices;
};

const partnerMatchesPriceRange = (partner, minPrice, maxPrice, serviceId, categoryId) => {
  if (minPrice == null && maxPrice == null) return true;

  const prices = collectPartnerOfferingPrices(partner, serviceId, categoryId);
  if (prices.length === 0) return false;

  return prices.some((price) => {
    if (minPrice != null && price < minPrice) return false;
    if (maxPrice != null && price > maxPrice) return false;
    return true;
  });
};

const applyPartnerFilters = (records, filters) => {
  const { search, plan_name, category_id, service_id, min_price, max_price } = filters;

  return records.filter(
    (p) =>
      partnerMatchesSearch(p, search) &&
      partnerMatchesPlan(p, plan_name) &&
      partnerMatchesCategory(p, category_id) &&
      partnerMatchesService(p, service_id) &&
      partnerMatchesPriceRange(p, min_price, max_price, service_id, category_id)
  );
};

/**
 * Per-partner price fields scoped to the list query context.
 * - service_id: single `price` (no range)
 * - category_id (no service_id): `price_range` for services in that category
 * - neither: `price_range` across all offered services
 */
const buildPartnerPriceFields = (partner, serviceId, categoryId) => {
  if (serviceId) {
    const prices = collectPartnerOfferingPrices(partner, serviceId, null);
    return {
      price: prices.length > 0 ? prices[0] : null,
      price_range: null,
    };
  }

  const scopeCategoryId = categoryId || null;
  const prices = collectPartnerOfferingPrices(partner, null, scopeCategoryId);

  if (prices.length === 0) {
    return { price: null, price_range: null };
  }

  return {
    price: null,
    price_range: {
      min: Math.min(...prices),
      max: Math.max(...prices),
    },
  };
};

const attachPartnerPriceFields = (partners, serviceId, categoryId) =>
  partners.map((partner) => ({
    ...partner,
    ...buildPartnerPriceFields(partner, serviceId || null, categoryId || null),
  }));

/** Shared list query parsing (no franchise_id). */
const parsePartnersListQuery = (query) => {
  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, parsePositiveInt(query.limit, DEFAULT_LIMIT));

  const minPriceParsed = parseOptionalPrice(query.min_price, 'min_price');
  if (!minPriceParsed.ok) {
    return { ok: false, status: 400, message: minPriceParsed.message };
  }
  const maxPriceParsed = parseOptionalPrice(query.max_price, 'max_price');
  if (!maxPriceParsed.ok) {
    return { ok: false, status: 400, message: maxPriceParsed.message };
  }

  if (
    minPriceParsed.value != null &&
    maxPriceParsed.value != null &&
    minPriceParsed.value > maxPriceParsed.value
  ) {
    return { ok: false, status: 400, message: 'min_price cannot be greater than max_price.' };
  }

  const planNameRaw = query.plan_name != null ? String(query.plan_name).trim().toLowerCase() : '';
  if (planNameRaw && !PLAN_NAMES.includes(planNameRaw)) {
    return {
      ok: false,
      status: 400,
      message: `plan_name must be one of: ${PLAN_NAMES.join(', ')}.`,
    };
  }

  const categoryId = query.category_id ? String(query.category_id).trim() : '';
  if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
    return { ok: false, status: 400, message: 'category_id must be a valid ObjectId.' };
  }

  const serviceId = query.service_id ? String(query.service_id).trim() : '';
  if (serviceId && !mongoose.Types.ObjectId.isValid(serviceId)) {
    return { ok: false, status: 400, message: 'service_id must be a valid ObjectId.' };
  }

  return {
    ok: true,
    page,
    limit,
    serviceId: serviceId || null,
    categoryId: categoryId || null,
    filters: {
      search: query.search ?? query.q ?? null,
      plan_name: planNameRaw || null,
      category_id: categoryId || null,
      service_id: serviceId || null,
      min_price: minPriceParsed.value,
      max_price: maxPriceParsed.value,
    },
  };
};

const paginatePartnerRecords = (records, { filters, serviceId, categoryId, page, limit }) => {
  const safeRecords = Array.isArray(records) ? records : [];
  const safeFilters = filters || {};
  const filtered = applyPartnerFilters(safeRecords, safeFilters);
  const totalItems = filtered.length;
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);
  const skip = (page - 1) * limit;
  const partners = attachPartnerPriceFields(
    filtered.slice(skip, skip + limit),
    serviceId,
    categoryId
  );

  return {
    partners,
    totalItems,
    totalPages,
    currentPage: page,
    limit,
  };
};

/**
 * Build partner list cards for a franchise (subscribed partners + catalog offerings).
 * Optional partnerIdAllowlist limits to specific partner Mongo ids.
 */
const buildFranchisePartnerListRecords = async (franchiseId, options = {}) => {
  const franchiseCtx = await resolveFranchiseById(franchiseId);
  if (!franchiseCtx.ok) {
    return fail(franchiseCtx.status, franchiseCtx.message);
  }

  const allowSet =
    options.partnerIdAllowlist != null
      ? new Set(options.partnerIdAllowlist.map((id) => String(id)))
      : null;

  const subscribed = await loadSubscribedFranchisePartners(franchiseCtx.franchise._id);

  let partners = subscribed.partners;
  if (allowSet) {
    partners = partners.filter((p) => allowSet.has(String(p._id)));
  }

  if (partners.length === 0) {
    return ok(200, {
      franchise_id: franchiseCtx.franchise._id,
      franchise_name: franchiseCtx.franchise.name,
      records: [],
    });
  }

  const catalogResolved = await resolveFranchiseEffectiveCatalog(franchiseCtx.franchise._id);
  if (!catalogResolved.ok) {
    return fail(catalogResolved.status, catalogResolved.message);
  }

  const effectiveServiceIds = (catalogResolved.effectiveServiceIds || []).map((x) => String(x));
  const partnerIds = partners.map((p) => p._id);

  const effectiveOfferings = await collectEffectivePartnerOfferings(
    franchiseCtx.franchise._id,
    effectiveServiceIds,
    partnerIds
  );

  const records = mapFranchisePartnerRecords(
    partners,
    subscribed.planByPartnerId,
    effectiveOfferings
  );

  const recordsWithRatings = await enrichPartnerListRecordsWithServiceRatings(records);

  return ok(200, {
    franchise_id: franchiseCtx.franchise._id,
    franchise_name: franchiseCtx.franchise.name,
    records: recordsWithRatings,
  });
};

const isPartnerSavedByUser = async (userId, partnerId) => {
  if (!userId || !partnerId) return false;
  const row = await CustomerSavedPartner.findOne({
    user_id: new mongoose.Types.ObjectId(String(userId)),
    partner_id: new mongoose.Types.ObjectId(String(partnerId)),
  })
    .select('_id')
    .lean();
  return Boolean(row);
};

const listFranchisePartnersPaginated = async (query) => {
  try {
    const franchiseCtx = await resolveFranchiseById(query.franchise_id);
    if (!franchiseCtx.ok) {
      return fail(franchiseCtx.status, franchiseCtx.message);
    }

    const parsed = parsePartnersListQuery(query);
    if (!parsed.ok) return fail(parsed.status, parsed.message);

    const built = await buildFranchisePartnerListRecords(franchiseCtx.franchise._id);
    if (!built.ok) return built;
    const builtData = built.data || {};
    if (!Array.isArray(builtData.records)) {
      console.error('listFranchisePartnersPaginated invalid records shape', {
        franchise_id: String(franchiseCtx.franchise._id),
        records_type: typeof builtData.records,
      });
      return fail(500, 'Internal server error.');
    }

    const paginated = paginatePartnerRecords(builtData.records, {
      filters: parsed.filters,
      serviceId: parsed.serviceId,
      categoryId: parsed.categoryId,
      page: parsed.page,
      limit: parsed.limit,
    });

    return ok(200, {
      message: 'Partners fetched successfully.',
      data: {
        franchise_id: builtData.franchise_id,
        franchise_name: builtData.franchise_name,
        ...paginated,
      },
    });
  } catch (err) {
    console.error('listFranchisePartnersPaginated', {
      message: err?.message,
      stack: err?.stack,
      query,
    });
    return fail(500, 'Internal server error.');
  }
};

const mapPartnerProfileLocation = (partner) => ({
  state_name: partner.state_id?.name ?? null,
  city_name: partner.city_id?.name ?? null,
  area_name: partner.area_id?.name ?? null,
});

/** Completed order service lines (same basis as admin GET partner service count). */
const countPartnerCompletedServices = async (partnerId) => {
  const partnerOid = new mongoose.Types.ObjectId(String(partnerId));
  const result = await OrderService.aggregate([
    {
      $match: {
        partner_id: partnerOid,
        service_status: ORDER_STATUS_COMPLETED,
        deleted_at: null,
      },
    },
    { $count: 'total' },
  ]);
  return result[0]?.total ?? 0;
};

const mapPartnerBusinessInfo = (partner) => {
  if (!partner.is_business || !partner.business_info_id) {
    return null;
  }
  const bi = partner.business_info_id;
  if (bi.deleted_at != null) {
    return null;
  }
  return {
    name: bi.name ?? null,
    provided_service: bi.provided_service ?? null,
  };
};

const getPartnerProfileForCustomer = async (partnerId, franchiseId, userId = null) => {
  try {
    const partnerKey = String(partnerId ?? '').trim();
    if (!partnerKey || !mongoose.Types.ObjectId.isValid(partnerKey)) {
      return fail(400, 'partnerId must be a valid ObjectId.');
    }

    const franchiseIdRaw =
      franchiseId !== undefined && franchiseId !== null ? String(franchiseId).trim() : '';

    let franchiseCtx = null;
    const partnerQuery = {
      _id: partnerKey,
      type: USER_TYPE_PARTNER,
      verification_status: 2,
      is_active: true,
      is_blocked: { $ne: true },
      deleted_at: null,
    };

    if (franchiseIdRaw) {
      franchiseCtx = await resolveFranchiseById(franchiseIdRaw);
      if (!franchiseCtx.ok) {
        return fail(franchiseCtx.status, franchiseCtx.message);
      }
      partnerQuery.franchise_id = franchiseCtx.franchise._id;
    }

    const partner = await User.findOne(partnerQuery)
      .select(
        'name profile_url user_id experience is_business business_info_id state_id city_id area_id created_at average_rating rating_count'
      )
      .populate([
        { path: 'state_id', select: 'name' },
        { path: 'city_id', select: 'name' },
        { path: 'area_id', select: 'name' },
        { path: 'business_info_id', select: 'name provided_service deleted_at' },
      ])
      .lean();

    if (!partner) {
      return fail(404, 'Partner not found.');
    }

    if (!franchiseCtx) {
      if (!partner.franchise_id) {
        return fail(404, 'Partner not found.');
      }
      franchiseCtx = await resolveFranchiseById(partner.franchise_id);
      if (!franchiseCtx.ok) {
        return fail(franchiseCtx.status, franchiseCtx.message);
      }
    }

    const subscribed = await loadSubscribedFranchisePartners(franchiseCtx.franchise._id);
    const plan = subscribed.planByPartnerId.get(String(partner._id));
    if (!plan) {
      return fail(404, 'Partner not found.');
    }

    const [catalogResult, completedServicesCount, isSaved] = await Promise.all([
      buildPartnerDetailCatalog(franchiseCtx.franchise._id, partner._id),
      countPartnerCompletedServices(partner._id),
      userId ? isPartnerSavedByUser(userId, partner._id) : Promise.resolve(false),
    ]);
    if (!catalogResult.ok) {
      return fail(catalogResult.status, catalogResult.message);
    }

    const categoriesWithRatings = await enrichPartnerCatalogWithRatings(
      partner._id,
      catalogResult.categories
    );
    const partnerRatings = attachPartnerRatingFields(partner);

    return ok(200, {
      message: 'Partner profile fetched successfully.',
      data: {
        franchise_id: franchiseCtx.franchise._id,
        franchise_name: franchiseCtx.franchise.name,
        partner: {
          _id: partner._id,
          name: partner.name,
          profile_url: partner.profile_url,
          user_id: partner.user_id,
          experience: partner.experience,
          professional_summary: partner.experience,
          subscription_plan_name: plan.plan_name,
          plan_priority: plan.priority,
          is_business: partner.is_business === true,
          business_info: mapPartnerBusinessInfo(partner),
          location: mapPartnerProfileLocation(partner),
          joined_at: partner.created_at ?? null,
          completed_services_count: completedServicesCount,
          no_of_services_completed: completedServicesCount,
          is_saved: isSaved,
          ...partnerRatings,
        },
        categories: categoriesWithRatings,
      },
    });
  } catch (err) {
    console.error('getPartnerProfileForCustomer', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listFranchisePartnersPaginated,
  getPartnerProfileForCustomer,
  parsePartnersListQuery,
  paginatePartnerRecords,
  buildFranchisePartnerListRecords,
  isPartnerSavedByUser,
};
