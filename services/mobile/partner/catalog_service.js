const mongoose = require('mongoose');
const User = require('../../../models/user');
const Category = require('../../../models/category');
const Service = require('../../../models/service');
const { resolveFranchiseEffectiveCatalog } = require('../../../utils/catalog_availability_resolver');

const USER_TYPE_PARTNER = 2;

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

const loadPartnerFranchiseId = async (partnerId) => {
  if (!mongoose.Types.ObjectId.isValid(String(partnerId))) {
    return { ok: false, status: 401, message: 'Invalid token.' };
  }

  const user = await User.findOne({
    _id: partnerId,
    type: USER_TYPE_PARTNER,
    deleted_at: null,
  })
    .select('franchise_id')
    .lean();

  if (!user) {
    return { ok: false, status: 404, message: 'Partner not found.' };
  }

  if (!user.franchise_id) {
    return {
      ok: false,
      status: 400,
      message: 'Partner is not linked to a franchise. Complete your location on profile first.',
    };
  }

  return { ok: true, franchiseId: user.franchise_id };
};

const listFranchiseCategoriesForPartner = async (partnerId) => {
  try {
    const partner = await loadPartnerFranchiseId(partnerId);
    if (!partner.ok) return partner;

    const resolved = await resolveFranchiseEffectiveCatalog(partner.franchiseId);
    if (!resolved.ok) {
      return { ok: false, status: resolved.status, message: resolved.message };
    }

    const ids = resolved.effectiveCategoryIds || [];
    if (ids.length === 0) {
      return {
        ok: true,
        data: {
          message: 'Categories fetched successfully.',
          records: [],
        },
      };
    }

    const categories = await Category.find({
      _id: { $in: ids },
      ...ACTIVE_CATEGORY_FILTER,
    })
      .select('name desc image_url')
      .sort({ created_at: -1 })
      .lean();

    const records = categories.map((c) => ({
      _id: c._id,
      name: c.name,
      desc: c.desc,
      image_url: c.image_url,
    }));

    return {
      ok: true,
      data: {
        message: 'Categories fetched successfully.',
        records,
      },
    };
  } catch (err) {
    console.error('listFranchiseCategoriesForPartner', err.message);
    return { ok: false, status: 500, message: 'Internal server error.' };
  }
};

const listFranchiseServicesForPartner = async (partnerId, categoryIdRaw) => {
  try {
    const categoryId =
      categoryIdRaw !== undefined && categoryIdRaw !== null ? String(categoryIdRaw).trim() : '';
    if (!categoryId) {
      return { ok: false, status: 400, message: 'category_id is required.' };
    }
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return { ok: false, status: 400, message: 'category_id must be a valid MongoDB ObjectId.' };
    }

    const partner = await loadPartnerFranchiseId(partnerId);
    if (!partner.ok) return partner;

    const categoryOid = new mongoose.Types.ObjectId(categoryId);
    const [category, franchiseCatalog] = await Promise.all([
      Category.findOne({ _id: categoryOid, deleted_at: null }).select('services').lean(),
      resolveFranchiseEffectiveCatalog(partner.franchiseId),
    ]);

    if (!category) {
      return { ok: false, status: 404, message: 'Category not found.' };
    }
    if (!franchiseCatalog.ok) {
      return { ok: false, status: franchiseCatalog.status, message: franchiseCatalog.message };
    }

    const categoryAllowed = (franchiseCatalog.effectiveCategoryIds || []).some(
      (id) => String(id) === String(categoryOid)
    );
    if (!categoryAllowed) {
      return {
        ok: false,
        status: 403,
        message: 'This category is not available for your franchise.',
      };
    }

    const catServices = Array.isArray(category.services) ? category.services : [];
    const effectiveSvcSet = new Set(
      (franchiseCatalog.effectiveServiceIds || []).map((x) => String(x))
    );
    const intersectionIds = catServices.filter((sid) => sid && effectiveSvcSet.has(String(sid)));

    if (intersectionIds.length === 0) {
      return {
        ok: true,
        data: {
          message: 'Services fetched successfully.',
          records: [],
        },
      };
    }

    const services = await Service.find({
      _id: { $in: intersectionIds },
      category_id: categoryOid,
      ...ACTIVE_SERVICE_FILTER,
    })
      .select('name desc tax image_url category_id')
      .lean();

    const byId = new Map(services.map((s) => [String(s._id), s]));
    const records = intersectionIds
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((s) => ({
        _id: s._id,
        name: s.name,
        desc: s.desc,
        tax: s.tax,
        image_url: s.image_url,
        category_id: s.category_id,
      }));

    return {
      ok: true,
      data: {
        message: 'Services fetched successfully.',
        records,
      },
    };
  } catch (err) {
    console.error('listFranchiseServicesForPartner', err.message);
    return { ok: false, status: 500, message: 'Internal server error.' };
  }
};

module.exports = {
  listFranchiseCategoriesForPartner,
  listFranchiseServicesForPartner,
};
