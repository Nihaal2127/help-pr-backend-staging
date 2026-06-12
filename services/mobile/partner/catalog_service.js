const Category = require('../../../models/category');
const Service = require('../../../models/service');
const PartnerService = require('../../../models/partner_service');
const { resolveFranchiseEffectiveCatalog } = require('../../../utils/catalog_availability_resolver');
const { loadPartnerFranchiseId } = require('../shared/partner_access_helpers');
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

const listFranchiseCategoriesForPartner = async (partnerId) => {
  try {
    const partner = await loadPartnerFranchiseId(partnerId);
    if (!partner.ok) return partner;

    const resolved = await resolveFranchiseEffectiveCatalog(partner.data.franchiseId);
    if (!resolved.ok) {
      return fail(resolved.status, resolved.message);
    }

    const ids = resolved.effectiveCategoryIds || [];
    if (ids.length === 0) {
      return ok(200, {
        message: 'Categories fetched successfully.',
        data: [],
      });
    }

    const effectiveSvcSet = new Set(
      (resolved.effectiveServiceIds || []).map((x) => String(x))
    );

    // Exclude services that this partner has already added.
    const alreadyAddedRows = await PartnerService.find({
      partner_id: partnerId,
      deleted_at: null,
    })
      .select('service_id')
      .lean();
    const alreadyAddedSvcSet = new Set(
      alreadyAddedRows.map((r) => (r.service_id ? String(r.service_id) : '')).filter(Boolean)
    );

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
        if (
          sid &&
          effectiveSvcSet.has(String(sid)) &&
          !alreadyAddedSvcSet.has(String(sid))
        ) {
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
            .select('name desc tax image_url category_id')
            .lean();

    const serviceById = new Map(serviceDocs.map((s) => [String(s._id), s]));

    const mapServiceRecord = (s) => ({
      _id: s._id,
      name: s.name,
      desc: s.desc,
      tax: s.tax,
      image_url: s.image_url,
      category_id: s.category_id,
    });

    const categoriesWithServices = categories.map((c) => {
      const catServices = Array.isArray(c.services) ? c.services : [];
      const intersectionIds = catServices.filter(
        (sid) =>
          sid &&
          effectiveSvcSet.has(String(sid)) &&
          !alreadyAddedSvcSet.has(String(sid))
      );
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
    }).filter((c) => Array.isArray(c.services) && c.services.length > 0);

    return ok(200, {
      message: 'Categories fetched successfully.',
      data: categoriesWithServices,
    });
  } catch (err) {
    console.error('listFranchiseCategoriesForPartner', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listFranchiseCategoriesForPartner,
};
