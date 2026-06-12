const mongoose = require('mongoose');
const Franchise = require('../../../models/franchise');
const Area = require('../../../models/area');
const City = require('../../../models/city');
const User = require('../../../models/user');
const Category = require('../../../models/category');
const Service = require('../../../models/service');
const PartnerCategory = require('../../../models/partner_category');
const PartnerService = require('../../../models/partner_service');
const PartnerSubscription = require('../../../models/partner_subscription');
const {
  resolveFranchiseEffectiveCatalog,
  resolveFranchiseAssignedEnabledMaps,
  enrichPartnerServiceApiRecord,
  loadPartnerAvailabilityContext,
} = require('../../../utils/catalog_availability_resolver');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');
const { attachPartnerRatingFields } = require('../../../utils/rating_format');

const { fail } = require('../../../utils/mobile_service_result');

const sanitizeCsvField = (value) => String(value ?? '').replace(/,/g, ' ').trim();
const normalizeKey = (value) => sanitizeCsvField(value).toLowerCase();

const parseLocationPayload = (raw) => {
  const line = String(raw ?? '').trim();
  if (!line) {
    return fail(400, 'Location is required.');
  }

  const parts = line.split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => !part)) {
    return fail(
      400,
      'Location must be in format: pincode,area_name,city_name,state_name'
    );
  }

  return {
    ok: true,
    location: {
      pincode: parts[0],
      area_name: parts[1],
      city_name: parts[2],
      state_name: parts[3],
    },
  };
};

const normalizeAreaPincodes = (pincodes) => {
  if (!pincodes || !Array.isArray(pincodes)) return [];
  return [...new Set(pincodes.map((p) => String(p).trim()).filter(Boolean))];
};

const resolveAreaFromLocation = async ({ pincode, area_name, city_name, state_name }) => {
  const pincodeKey = normalizeKey(pincode);
  const areaKey = normalizeKey(area_name);
  const cityKey = normalizeKey(city_name);
  const stateKey = normalizeKey(state_name);

  const areas = await Area.find({ deleted_at: null })
    .select('name pincodes city_id state_id state_name is_active')
    .lean();

  const cityIds = [
    ...new Set(
      areas
        .map((area) => area.city_id && area.city_id.toString())
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const cities = await City.find({ _id: { $in: cityIds }, deleted_at: null })
    .select('name')
    .lean();
  const cityNameById = new Map(cities.map((city) => [city._id.toString(), city.name]));

  const matches = [];
  for (const area of areas) {
    const pins = normalizeAreaPincodes(area.pincodes);
    const hasPincode = pins.some((p) => normalizeKey(p) === pincodeKey);
    if (!hasPincode) continue;
    if (normalizeKey(area.name) !== areaKey) continue;
    if (normalizeKey(area.state_name) !== stateKey) continue;

    const resolvedCityName = cityNameById.get(String(area.city_id)) || '';
    if (normalizeKey(resolvedCityName) !== cityKey) continue;

    matches.push(area);
  }

  if (matches.length === 0) {
    return fail(404, 'Location not found.');
  }

  return { ok: true, area: matches[0] };
};

const resolveFranchiseForArea = async (area) => {
  const areaOid =
    area._id instanceof mongoose.Types.ObjectId
      ? area._id
      : new mongoose.Types.ObjectId(String(area._id));

  const franchise = await Franchise.findOne({
    deleted_at: null,
    is_active: true,
    state_id: area.state_id,
    city_id: area.city_id,
    area_id: areaOid,
  })
    .sort({ updated_at: -1 })
    .select('_id name')
    .lean();

  if (!franchise) {
    return fail(400, 'No services are available in this location');
  }

  return { ok: true, franchise };
};

const resolveFranchiseFromLocation = async (rawLocation, options = {}) => {
  const { requireFranchise = true } = options;
  const parsed = parseLocationPayload(rawLocation);
  if (!parsed.ok) return parsed;

  const areaResult = await resolveAreaFromLocation(parsed.location);
  if (!areaResult.ok) return areaResult;

  const franchiseResult = await resolveFranchiseForArea(areaResult.area);
  if (!franchiseResult.ok) {
    if (requireFranchise) return franchiseResult;
    return {
      ok: true,
      franchise: null,
      area: areaResult.area,
      location: parsed.location,
      services_available: false,
    };
  }

  return {
    ok: true,
    franchise: franchiseResult.franchise,
    area: areaResult.area,
    location: parsed.location,
    services_available: true,
  };
};

const resolveFranchiseById = async (rawFranchiseId) => {
  const id = rawFranchiseId != null ? String(rawFranchiseId).trim() : '';
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return fail(400, 'franchise_id must be a valid ObjectId.');
  }

  const franchise = await Franchise.findOne({
    _id: new mongoose.Types.ObjectId(id),
    deleted_at: null,
    is_active: true,
  })
    .select('_id name')
    .lean();

  if (!franchise) {
    return fail(404, 'Franchise not found.');
  }

  return { ok: true, franchise };
};

const isLocallyEnabled = (flag) => Boolean(flag);

const loadPartnerLocalMapsByPartnerId = async (partnerIds) => {
  const byPartner = new Map();
  if (!partnerIds.length) return byPartner;

  const partnerOids = partnerIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  for (const id of partnerIds) {
    byPartner.set(String(id), {
      categoryEnabled: new Map(),
      serviceEnabled: new Map(),
      serviceCategoryById: new Map(),
    });
  }

  const [categoryRows, servicePrefRows] = await Promise.all([
    PartnerCategory.find({ partner_id: { $in: partnerOids }, deleted_at: null })
      .select('partner_id category_id is_active')
      .lean(),
    PartnerService.find({ partner_id: { $in: partnerOids }, deleted_at: null })
      .select('partner_id service_id category_id is_active')
      .lean(),
  ]);

  for (const row of categoryRows) {
    const maps = byPartner.get(String(row.partner_id));
    if (!maps || !row.category_id) continue;
    maps.categoryEnabled.set(String(row.category_id), isLocallyEnabled(row.is_active));
  }

  for (const row of servicePrefRows) {
    const maps = byPartner.get(String(row.partner_id));
    if (!maps || !row.service_id) continue;
    const serviceKey = String(row.service_id);
    maps.serviceEnabled.set(serviceKey, isLocallyEnabled(row.is_active));
    if (row.category_id) {
      maps.serviceCategoryById.set(serviceKey, String(row.category_id));
    }
  }

  return byPartner;
};

const comparePartnerPlanPriority = (priorityA, priorityB) => {
  const a = priorityA == null ? -1 : Number(priorityA);
  const b = priorityB == null ? -1 : Number(priorityB);
  if (Number.isNaN(a) && Number.isNaN(b)) return 0;
  if (Number.isNaN(a)) return 1;
  if (Number.isNaN(b)) return -1;
  return b - a;
};

/**
 * Franchise partners with a non-expired active subscription on an active plan.
 * Sorted highest plan priority first, then name. Optional `limit` caps results.
 */
const loadSubscribedFranchisePartners = async (franchiseId, options = {}) => {
  const { limit } = options;

  const partnerRows = await User.find({
    franchise_id: franchiseId,
    type: USER_TYPE_PARTNER,
    verification_status: 2,
    is_active: true,
    is_blocked: { $ne: true },
    deleted_at: null,
  })
    .select('name profile_url user_id experience average_rating rating_count')
    .lean();

  if (partnerRows.length === 0) {
    return { partnerIds: [], partners: [], planByPartnerId: new Map() };
  }

  const partnerOids = partnerRows.map((p) => p._id);
  const now = new Date();

  const subscriptionRows = await PartnerSubscription.find({
    partner_id: { $in: partnerOids },
    status: 'active',
    deleted_at: null,
    $or: [{ expires_at: null }, { expires_at: { $gt: now } }],
  })
    .select('partner_id subscription_plan_id created_at')
    .populate({
      path: 'subscription_plan_id',
      select: 'plan_name priority is_active deleted_at',
    })
    .sort({ created_at: -1 })
    .lean();

  const planByPartnerId = new Map();

  for (const row of subscriptionRows) {
    const partnerKey = String(row.partner_id);
    if (planByPartnerId.has(partnerKey)) continue;

    const plan = row.subscription_plan_id;
    if (!plan || plan.deleted_at != null || plan.is_active !== true) continue;

    planByPartnerId.set(partnerKey, {
      plan_name: plan.plan_name,
      priority: plan.priority,
    });
  }

  let subscribed = partnerRows
    .filter((p) => planByPartnerId.has(String(p._id)))
    .sort((a, b) => {
      const planA = planByPartnerId.get(String(a._id));
      const planB = planByPartnerId.get(String(b._id));
      const byPlan = comparePartnerPlanPriority(planA.priority, planB.priority);
      if (byPlan !== 0) return byPlan;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });

  if (limit != null && Number.isFinite(limit) && limit > 0) {
    subscribed = subscribed.slice(0, limit);
  }

  return {
    partnerIds: subscribed.map((p) => p._id),
    partners: subscribed,
    planByPartnerId,
  };
};

const collectEffectivePartnerOfferings = async (
  franchiseId,
  effectiveServiceIdStrs,
  subscribedPartnerIds = []
) => {
  const effectiveSvcSet = new Set(effectiveServiceIdStrs);
  if (effectiveSvcSet.size === 0 || subscribedPartnerIds.length === 0) {
    return [];
  }

  const franchiseLocal = await resolveFranchiseAssignedEnabledMaps(franchiseId);
  if (!franchiseLocal.ok) {
    return [];
  }

  const serviceOids = [...effectiveSvcSet]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const partnerOids = subscribedPartnerIds.map((id) => new mongoose.Types.ObjectId(String(id)));

  const offeringRows = await PartnerService.find({
    partner_id: { $in: partnerOids },
    service_id: { $in: serviceOids },
    deleted_at: null,
  })
    .select('partner_id category_id service_id price is_active')
    .lean();

  if (offeringRows.length === 0) {
    return [];
  }

  const partnerLocalById = await loadPartnerLocalMapsByPartnerId(subscribedPartnerIds);

  const serviceIdStrs = [...new Set(offeringRows.map((r) => String(r.service_id)))];
  const categoryIdStrs = [
    ...new Set(
      offeringRows.map((r) => (r.category_id ? String(r.category_id) : '')).filter(Boolean)
    ),
  ];

  const [serviceDocs, categoryDocs] = await Promise.all([
    Service.find({ _id: { $in: serviceIdStrs }, deleted_at: null })
      .select('_id name is_active is_request category_id')
      .lean(),
    categoryIdStrs.length === 0
      ? []
      : Category.find({ _id: { $in: categoryIdStrs }, deleted_at: null })
          .select('_id name is_active is_request')
          .lean(),
  ]);

  const serviceDocById = new Map(serviceDocs.map((s) => [String(s._id), s]));
  const categoryDocById = new Map(categoryDocs.map((c) => [String(c._id), c]));

  const effectiveRows = [];

  for (const row of offeringRows) {
    const serviceKey = String(row.service_id);
    if (!effectiveSvcSet.has(serviceKey)) continue;

    const partnerKey = String(row.partner_id);
    const partnerLocal = partnerLocalById.get(partnerKey);
    if (!partnerLocal) continue;

    const categoryKey = row.category_id ? String(row.category_id) : '';
    const enriched = enrichPartnerServiceApiRecord(
      row,
      {
        ok: true,
        franchiseId,
        partnerLocal,
        franchiseLocal,
      },
      serviceDocById.get(serviceKey),
      categoryKey ? categoryDocById.get(categoryKey) : null
    );

    if (!enriched.effective_active) continue;

    const serviceDoc = serviceDocById.get(serviceKey);
    const categoryDoc = categoryKey ? categoryDocById.get(categoryKey) : null;

    effectiveRows.push({
      partner_id: row.partner_id,
      category_id: row.category_id,
      service_id: row.service_id,
      price: row.price,
      category_name: categoryDoc?.name ?? null,
      service_name: serviceDoc?.name ?? null,
    });
  }

  return effectiveRows;
};

const groupOfferingsByPartner = (effectiveRows) => {
  const byPartner = new Map();

  for (const row of effectiveRows) {
    const partnerKey = String(row.partner_id);
    const categoryKey = row.category_id ? String(row.category_id) : '';
    if (!categoryKey) continue;

    if (!byPartner.has(partnerKey)) {
      byPartner.set(partnerKey, new Map());
    }

    const categoryMap = byPartner.get(partnerKey);
    if (!categoryMap.has(categoryKey)) {
      categoryMap.set(categoryKey, {
        _id: row.category_id,
        name: row.category_name,
        services: [],
      });
    }

    categoryMap.get(categoryKey).services.push({
      _id: row.service_id,
      name: row.service_name,
      price: row.price,
    });
  }

  const result = new Map();
  for (const [partnerKey, categoryMap] of byPartner) {
    const categories = [...categoryMap.values()]
      .map((cat) => ({
        ...cat,
        services: cat.services.sort((a, b) =>
          String(a.name ?? '').localeCompare(String(b.name ?? ''))
        ),
      }))
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));

    result.set(partnerKey, categories);
  }

  return result;
};

const mapFranchisePartnerRecords = (subscribedPartners, planByPartnerId, effectiveOfferings = []) => {
  const categoriesByPartnerId = groupOfferingsByPartner(effectiveOfferings);

  return subscribedPartners.map((p) => {
    const plan = planByPartnerId.get(String(p._id));
    return {
      _id: p._id,
      name: p.name,
      profile_url: p.profile_url,
      user_id: p.user_id,
      experience: p.experience,
      subscription_plan_name: plan?.plan_name ?? null,
      plan_priority: plan?.priority ?? null,
      categories: categoriesByPartnerId.get(String(p._id)) || [],
      ...attachPartnerRatingFields(p),
    };
  });
};

const mapCustomerPartnerServiceRow = (row) => {
  const service = row.service_id;
  const category = row.category_id;
  return {
    partner_service_id: row._id,
    service_id: service?._id ?? row.service_id ?? null,
    service_name: service?.name ?? null,
    service_desc: service?.desc ?? null,
    service_image_url: service?.image_url ?? null,
    category_id: category?._id ?? row.category_id ?? null,
    description: row.description ?? '',
    price: row.price ?? 0,
    tax: row.tax ?? 0,
    payment_type: row.payment_type ?? '',
    minimum_deposit: row.minimum_deposit ?? 0,
    is_accept_request: row.is_accept_request === true,
  };
};

/**
 * Partner catalog for customer profile: only franchise-effective, locally enabled offerings.
 */
const buildPartnerDetailCatalog = async (franchiseId, partnerId) => {
  const catalogResolved = await resolveFranchiseEffectiveCatalog(franchiseId);
  if (!catalogResolved.ok) {
    return catalogResolved;
  }

  const effectiveSvcSet = new Set(
    (catalogResolved.effectiveServiceIds || []).map((id) => String(id))
  );
  if (effectiveSvcSet.size === 0) {
    return { ok: true, categories: [] };
  }

  const availabilityCtx = await loadPartnerAvailabilityContext(partnerId);
  if (!availabilityCtx.ok) {
    return availabilityCtx;
  }

  if (
    availabilityCtx.franchiseId &&
    String(availabilityCtx.franchiseId) !== String(franchiseId)
  ) {
    return { ok: true, categories: [] };
  }

  const franchiseLocal = await resolveFranchiseAssignedEnabledMaps(franchiseId);
  if (!franchiseLocal.ok) {
    return franchiseLocal;
  }

  const partnerOid = new mongoose.Types.ObjectId(String(partnerId));
  const serviceOids = [...effectiveSvcSet]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const offeringRows = await PartnerService.find({
    partner_id: partnerOid,
    service_id: { $in: serviceOids },
    deleted_at: null,
  })
    .populate([
      { path: 'category_id', select: 'name desc image_url is_active is_request approval_status' },
      {
        path: 'service_id',
        select: 'name desc image_url category_id is_active is_request approval_status payment_type',
      },
    ])
    .sort({ category_id: 1, created_at: 1 })
    .lean();

  const resolverCtx = {
    ok: true,
    franchiseId,
    partnerLocal: availabilityCtx.partnerLocal,
    franchiseLocal,
  };

  const categoryMap = new Map();

  for (const row of offeringRows) {
    const serviceKey = String(row.service_id?._id ?? row.service_id ?? '');
    if (!effectiveSvcSet.has(serviceKey)) continue;

    const enriched = enrichPartnerServiceApiRecord(
      row,
      resolverCtx,
      row.service_id,
      row.category_id
    );
    if (!enriched.effective_active) continue;

    const category = row.category_id;
    const categoryKey = category?._id
      ? String(category._id)
      : row.category_id
        ? String(row.category_id)
        : null;
    if (!categoryKey) continue;

    if (!categoryMap.has(categoryKey)) {
      categoryMap.set(categoryKey, {
        category_id: category?._id ?? row.category_id,
        category_name: category?.name ?? null,
        category_desc: category?.desc ?? null,
        category_image_url: category?.image_url ?? null,
        services: [],
      });
    }

    categoryMap.get(categoryKey).services.push(mapCustomerPartnerServiceRow(row));
  }

  const categories = [...categoryMap.values()]
    .map((cat) => ({
      ...cat,
      services: cat.services.sort((a, b) =>
        String(a.service_name ?? '').localeCompare(String(b.service_name ?? ''))
      ),
    }))
    .sort((a, b) =>
      String(a.category_name ?? '').localeCompare(String(b.category_name ?? ''))
    );

  return { ok: true, categories };
};

module.exports = {
  resolveFranchiseFromLocation,
  resolveFranchiseById,
  loadSubscribedFranchisePartners,
  collectEffectivePartnerOfferings,
  mapFranchisePartnerRecords,
  buildPartnerDetailCatalog,
};
