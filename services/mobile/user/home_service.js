const mongoose = require('mongoose');
const Franchise = require('../../../models/franchise');
const Area = require('../../../models/area');
const City = require('../../../models/city');
const User = require('../../../models/user');
const Category = require('../../../models/category');
const Service = require('../../../models/service');
const { resolveFranchiseEffectiveCatalog } = require('../../../utils/catalog_availability_resolver');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

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

const buildFranchiseCategories = async (franchiseId, servicePrice = 0) => {
  const resolved = await resolveFranchiseEffectiveCatalog(franchiseId);
  if (!resolved.ok) {
    return fail(resolved.status, resolved.message);
  }

  const ids = resolved.effectiveCategoryIds || [];
  if (ids.length === 0) {
    return { ok: true, categories: [] };
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

  const mapServiceRecord = (s) => ({
    _id: s._id,
    name: s.name,
    desc: s.desc,
    tax: s.tax,
    image_url: s.image_url,
    category_id: s.category_id,
    price: servicePrice,
    payment_type: s.payment_type ?? '',
  });

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

  return { ok: true, categories: categoriesWithServices };
};

const listFranchisePartners = async (franchiseId) => {
  const partners = await User.find({
    franchise_id: franchiseId,
    type: USER_TYPE_PARTNER,
    verification_status: 2,
    is_active: true,
    is_blocked: { $ne: true },
    deleted_at: null,
  })
    .select('name profile_url user_id experience')
    .sort({ name: 1 })
    .lean();

  return partners.map((p) => ({
    _id: p._id,
    name: p.name,
    profile_url: p.profile_url,
    user_id: p.user_id,
    experience: p.experience,
  }));
};

const getHomeForLocation = async ({ location }) => {
  try {
    const parsed = parseLocationPayload(location);
    if (!parsed.ok) return parsed;

    const areaResult = await resolveAreaFromLocation(parsed.location);
    if (!areaResult.ok) return areaResult;

    const franchiseResult = await resolveFranchiseForArea(areaResult.area);
    if (!franchiseResult.ok) return franchiseResult;

    const city = await City.findById(areaResult.area.city_id)
      .select('city_service_price')
      .lean();
    const servicePrice = city?.city_service_price ?? 0;

    const catalogResult = await buildFranchiseCategories(
      franchiseResult.franchise._id,
      servicePrice
    );
    if (!catalogResult.ok) return catalogResult;

    const partners = await listFranchisePartners(franchiseResult.franchise._id);

    return ok(200, {
      message: 'Home data fetched successfully.',
      data: {
        franchise_id: franchiseResult.franchise._id,
        franchise_name: franchiseResult.franchise.name,
        location: {
          pincode: parsed.location.pincode,
          area_name: parsed.location.area_name,
          city_name: parsed.location.city_name,
          state_name: parsed.location.state_name,
          area_id: areaResult.area._id,
          city_id: areaResult.area.city_id,
          state_id: areaResult.area.state_id,
        },
        categories: catalogResult.categories,
        partners,
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
