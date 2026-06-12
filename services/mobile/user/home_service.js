const mongoose = require('mongoose');
const Category = require('../../../models/category');
const Service = require('../../../models/service');
const City = require('../../../models/city');
const { resolveFranchiseEffectiveCatalog } = require('../../../utils/catalog_availability_resolver');
const {
  resolveFranchiseFromLocation,
  loadSubscribedFranchisePartners,
  collectEffectivePartnerOfferings,
  mapFranchisePartnerRecords,
} = require('./franchise_partner_scope');
const { enrichPartnerListRecordsWithServiceRatings } = require('./partner_rating_service');
const { loadCustomerHomeOrders } = require('./home_orders_service');

/** Max partners returned on home (highest plan priority first). */
const HOME_PARTNERS_LIMIT = 20;

const { fail, ok } = require('../../../utils/mobile_service_result');

const ACTIVE_CATEGORY_FILTER = {
  deleted_at: null,
  is_active: true,
  is_request: false,
  approval_status: 'approve',
};

const ACTIVE_SERVICE_FILTER = {
  deleted_at: null,
  is_active: true,
  is_request: false,
  approval_status: 'approve',
};

const buildServiceOfferingStats = (effectiveRows) => {
  const aggregate = new Map();

  for (const row of effectiveRows) {
    const serviceKey = String(row.service_id);
    const partnerKey = String(row.partner_id);

    if (!aggregate.has(serviceKey)) {
      aggregate.set(serviceKey, { partnerIds: new Set(), prices: [] });
    }

    const entry = aggregate.get(serviceKey);
    entry.partnerIds.add(partnerKey);

    const price = Number(row.price);
    if (!Number.isNaN(price)) {
      entry.prices.push(price);
    }
  }

  const statsByServiceId = new Map();
  for (const [serviceKey, { partnerIds: offeringPartnerIds, prices }] of aggregate) {
    const partner_count = offeringPartnerIds.size;
    let price_range = null;
    if (prices.length > 0) {
      price_range = {
        min: Math.min(...prices),
        max: Math.max(...prices),
      };
    }
    statsByServiceId.set(serviceKey, { partner_count, price_range });
  }

  return statsByServiceId;
};

const buildFranchiseCategories = async (
  franchiseId,
  servicePrice = 0,
  subscribedPartnerIds = []
) => {
  const resolved = await resolveFranchiseEffectiveCatalog(franchiseId);
  if (!resolved.ok) {
    return fail(resolved.status, resolved.message);
  }

  const ids = resolved.effectiveCategoryIds || [];
  if (ids.length === 0) {
    return { ok: true, categories: [], effectiveOfferings: [] };
  }

  const effectiveSvcSet = new Set((resolved.effectiveServiceIds || []).map((x) => String(x)));

  const categories = await Category.find({
    _id: { $in: ids },
    ...ACTIVE_CATEGORY_FILTER,
  })
    .select('name desc image_url services')
    .sort({ created_at: -1 })
    .lean();

  const serviceIdSet = new Set();
  for (const category of categories) {
    const catServices = Array.isArray(category.services) ? category.services : [];
    for (const sid of catServices) {
      if (sid && effectiveSvcSet.has(String(sid))) {
        serviceIdSet.add(String(sid));
      }
    }
  }

  const serviceDocs =
    serviceIdSet.size === 0
      ? []
      : await Service.find({
          _id: { $in: [...serviceIdSet] },
          ...ACTIVE_SERVICE_FILTER,
        })
          .select('name desc tax image_url category_id payment_type')
          .lean();

  const serviceById = new Map(serviceDocs.map((s) => [String(s._id), s]));

  const effectiveOfferings = await collectEffectivePartnerOfferings(
    franchiseId,
    [...effectiveSvcSet],
    subscribedPartnerIds
  );
  const offeringStatsByServiceId = buildServiceOfferingStats(effectiveOfferings);

  const mapServiceRecord = (s) => {
    const stats = offeringStatsByServiceId.get(String(s._id)) || {
      partner_count: 0,
      price_range: null,
    };
    return {
      _id: s._id,
      name: s.name,
      desc: s.desc,
      tax: s.tax,
      image_url: s.image_url,
      category_id: s.category_id,
      partner_count: stats.partner_count,
      price_range: stats.price_range,
      price: servicePrice,
      payment_type: s.payment_type ?? '',
    };
  };

  const categoriesWithServices = categories.map((c) => {
    const catServices = Array.isArray(c.services) ? c.services : [];
    const intersectionIds = catServices.filter((sid) => sid && effectiveSvcSet.has(String(sid)));
    const services = intersectionIds
      .map((id) => serviceById.get(String(id)))
      .filter((s) => s && String(s.category_id) === String(c._id))
      .map(mapServiceRecord);

    return {
      _id: c._id,
      name: c.name,
      desc: c.desc,
      image_url: c.image_url,
      services,
    };
  });

  return {
    ok: true,
    categories: categoriesWithServices,
    effectiveOfferings,
  };
};

const buildResolvedLocation = (franchiseCtx) => ({
  pincode: franchiseCtx.location.pincode,
  area_name: franchiseCtx.location.area_name,
  city_name: franchiseCtx.location.city_name,
  state_name: franchiseCtx.location.state_name,
  area_id: franchiseCtx.area._id,
  city_id: franchiseCtx.area.city_id,
  state_id: franchiseCtx.area.state_id,
});

const getHomeForLocation = async ({ location, userId }) => {
  try {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return fail(401, 'Invalid token.');
    }

    const [franchiseCtx, orders] = await Promise.all([
      resolveFranchiseFromLocation(location, { requireFranchise: false }),
      loadCustomerHomeOrders(userId),
    ]);
    if (!franchiseCtx.ok) return franchiseCtx;

    if (!franchiseCtx.franchise) {
      return ok(200, {
        message: 'Home data fetched successfully.',
        data: {
          services_available: false,
          franchise_id: null,
          franchise_name: null,
          location: buildResolvedLocation(franchiseCtx),
          categories: [],
          partners: [],
          orders,
        },
      });
    }

    const city = await City.findById(franchiseCtx.area.city_id)
      .select('city_service_price')
      .lean();
    const servicePrice = city?.city_service_price ?? 0;

    const subscribed = await loadSubscribedFranchisePartners(franchiseCtx.franchise._id, {
      limit: HOME_PARTNERS_LIMIT,
    });

    const catalogResult = await buildFranchiseCategories(
      franchiseCtx.franchise._id,
      servicePrice,
      subscribed.partnerIds
    );
    if (!catalogResult.ok) return catalogResult;

    const partners = mapFranchisePartnerRecords(
      subscribed.partners,
      subscribed.planByPartnerId,
      catalogResult.effectiveOfferings || []
    );
    const partnersWithRatings = await enrichPartnerListRecordsWithServiceRatings(partners);

    return ok(200, {
      message: 'Home data fetched successfully.',
      data: {
        services_available: true,
        franchise_id: franchiseCtx.franchise._id,
        franchise_name: franchiseCtx.franchise.name,
        location: buildResolvedLocation(franchiseCtx),
        categories: catalogResult.categories,
        partners: partnersWithRatings,
        orders,
      },
    });
  } catch (err) {
    console.error('mobile user home', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  getHomeForLocation,
};
