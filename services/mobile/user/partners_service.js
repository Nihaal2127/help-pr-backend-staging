const mongoose = require('mongoose');
const { resolveFranchiseEffectiveCatalog } = require('../../../utils/catalog_availability_resolver');
const { PLAN_NAMES } = require('../../../models/subscription_plan');
const {
  resolveFranchiseById,
  loadSubscribedFranchisePartners,
  collectEffectivePartnerOfferings,
  mapFranchisePartnerRecords,
} = require('./franchise_partner_scope');

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const parsePositiveInt = (raw, fallback) => {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

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

const listFranchisePartnersPaginated = async (query) => {
  try {
    const franchiseCtx = await resolveFranchiseById(query.franchise_id);
    if (!franchiseCtx.ok) {
      return fail(franchiseCtx.status, franchiseCtx.message);
    }

    const page = parsePositiveInt(query.page, DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, parsePositiveInt(query.limit, DEFAULT_LIMIT));

    const minPriceParsed = parseOptionalPrice(query.min_price, 'min_price');
    if (!minPriceParsed.ok) return fail(400, minPriceParsed.message);
    const maxPriceParsed = parseOptionalPrice(query.max_price, 'max_price');
    if (!maxPriceParsed.ok) return fail(400, maxPriceParsed.message);

    if (
      minPriceParsed.value != null &&
      maxPriceParsed.value != null &&
      minPriceParsed.value > maxPriceParsed.value
    ) {
      return fail(400, 'min_price cannot be greater than max_price.');
    }

    const planNameRaw = query.plan_name != null ? String(query.plan_name).trim().toLowerCase() : '';
    if (planNameRaw && !PLAN_NAMES.includes(planNameRaw)) {
      return fail(
        400,
        `plan_name must be one of: ${PLAN_NAMES.join(', ')}.`
      );
    }

    const categoryId = query.category_id ? String(query.category_id).trim() : '';
    if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
      return fail(400, 'category_id must be a valid ObjectId.');
    }

    const serviceId = query.service_id ? String(query.service_id).trim() : '';
    if (serviceId && !mongoose.Types.ObjectId.isValid(serviceId)) {
      return fail(400, 'service_id must be a valid ObjectId.');
    }

    const subscribed = await loadSubscribedFranchisePartners(franchiseCtx.franchise._id);

    const catalogResolved = await resolveFranchiseEffectiveCatalog(franchiseCtx.franchise._id);
    if (!catalogResolved.ok) {
      return fail(catalogResolved.status, catalogResolved.message);
    }

    const effectiveServiceIds = (catalogResolved.effectiveServiceIds || []).map((x) =>
      String(x)
    );

    const effectiveOfferings = await collectEffectivePartnerOfferings(
      franchiseCtx.franchise._id,
      effectiveServiceIds,
      subscribed.partnerIds
    );

    const allRecords = mapFranchisePartnerRecords(
      subscribed.partners,
      subscribed.planByPartnerId,
      effectiveOfferings
    );

    const filtered = applyPartnerFilters(allRecords, {
      search: query.search ?? query.q,
      plan_name: planNameRaw || null,
      category_id: categoryId || null,
      service_id: serviceId || null,
      min_price: minPriceParsed.value,
      max_price: maxPriceParsed.value,
    });

    const totalItems = filtered.length;
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);
    const skip = (page - 1) * limit;
    const partners = attachPartnerPriceFields(
      filtered.slice(skip, skip + limit),
      serviceId || null,
      categoryId || null
    );

    return ok(200, {
      message: 'Partners fetched successfully.',
      data: {
        franchise_id: franchiseCtx.franchise._id,
        franchise_name: franchiseCtx.franchise.name,
        partners,
        totalItems,
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (err) {
    console.error('listFranchisePartnersPaginated', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listFranchisePartnersPaginated,
};
