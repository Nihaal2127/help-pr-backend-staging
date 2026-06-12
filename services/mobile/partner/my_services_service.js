const mongoose = require('mongoose');
const PartnerService = require('../../../models/partner_service');
const Category = require('../../../models/category');
const Service = require('../../../models/service');
const { rebuildPartnerCategoriesFromPartnerServices } = require('../../../services/partner_category_service');
const { resolveFranchiseEffectiveCatalog } = require('../../../utils/catalog_availability_resolver');
const {
  assertActivePartner,
  assertVerifiedPartner,
} = require('../shared/partner_access_helpers');

const OBJECT_ID_HEX_24 = /^[a-fA-F0-9]{24}$/;

const { fail, ok } = require('../../../utils/mobile_service_result');

const isPresentFieldValue = (value) =>
  value !== undefined && value !== null && String(value).trim() !== '';

const parseObjectId = (raw, fieldName) => {
  const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
  if (!s || !OBJECT_ID_HEX_24.test(s)) {
    return { ok: false, message: `${fieldName} must be a valid id.` };
  }
  return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const parsePrice = (value) => {
  if (!isPresentFieldValue(value)) {
    return { ok: false, message: 'Price is required.' };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: 'Price must be a valid number.' };
  }
  return { ok: true, n };
};

const parseDescription = (value) => {
  if (!isPresentFieldValue(value)) {
    return { ok: false, message: 'Description is required.' };
  }
  return { ok: true, text: String(value).trim() };
};

const parseIsActive = (value, fieldName = 'is_active') => {
  if (value === true || value === 'true') {
    return { ok: true, active: true };
  }
  if (value === false || value === 'false') {
    return { ok: true, active: false };
  }
  return { ok: false, message: `${fieldName} must be true or false.` };
};

const loadApprovedPartner = (partnerId) =>
  assertVerifiedPartner(partnerId, { select: '_id franchise_id verification_status' });

const assertCategoryAndServiceAvailable = async (categoryOid, serviceOid, franchiseId) => {
  const category = await Category.findOne({ _id: categoryOid, deleted_at: null }).lean();
  if (!category) {
    return fail(400, 'Category not found.');
  }
  if (!category.is_active || category.is_request || category.approval_status !== 'approve') {
    return fail(400, 'Category is not available.');
  }

  const service = await Service.findOne({ _id: serviceOid, deleted_at: null }).lean();
  if (!service) {
    return fail(400, 'Service not found.');
  }
  if (String(service.category_id) !== String(categoryOid)) {
    return fail(400, 'Service does not belong to the selected category.');
  }
  if (!service.is_active || service.is_request || service.approval_status !== 'approve') {
    return fail(400, 'Service is not available.');
  }

  if (franchiseId) {
    const resolved = await resolveFranchiseEffectiveCatalog(franchiseId);
    if (!resolved.ok) {
      return fail(resolved.status, resolved.message);
    }
    const catSet = new Set((resolved.effectiveCategoryIds || []).map((id) => String(id)));
    const svcSet = new Set((resolved.effectiveServiceIds || []).map((id) => String(id)));
    if (!catSet.has(String(categoryOid))) {
      return fail(400, 'Category is not available for your franchise.');
    }
    if (!svcSet.has(String(serviceOid))) {
      return fail(400, 'Service is not available for your franchise.');
    }
  }

  return ok(200, {});
};

const mapPartnerServiceRow = (row) => {
  const service = row.service_id;
  return {
    _id: row._id,
    service_id: service?._id ?? row.service_id ?? null,
    service_name: service?.name ?? null,
    service_desc: service?.desc ?? null,
    service_image_url: service?.image_url ?? null,
    description: row.description ?? '',
    price: row.price ?? 0,
    tax: row.tax ?? 0,
    minimum_deposit: row.minimum_deposit ?? 0,
    payment_type: row.payment_type ?? '',
    commission: row.commission ?? 0,
    is_active: row.is_active !== false,
    is_accept_request: row.is_accept_request === true,
  };
};

const listPartnerMyServices = async (partnerId) => {
  try {
    const partnerResult = await assertActivePartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    const { partnerOid } = partnerResult.data;
    const rows = await PartnerService.find({
      partner_id: partnerOid,
      deleted_at: null,
    })
      .populate([
        { path: 'category_id', select: 'name desc image_url' },
        { path: 'service_id', select: 'name desc image_url category_id' },
      ])
      .sort({ category_id: 1, created_at: 1 })
      .lean();

    const categoryMap = new Map();

    for (const row of rows) {
      const category = row.category_id;
      const categoryKey = category?._id
        ? String(category._id)
        : row.category_id
          ? String(row.category_id)
          : null;
      if (!categoryKey) {
        continue;
      }

      if (!categoryMap.has(categoryKey)) {
        categoryMap.set(categoryKey, {
          category_id: category?._id ?? row.category_id,
          category_name: category?.name ?? null,
          category_desc: category?.desc ?? null,
          category_image_url: category?.image_url ?? null,
          services: [],
        });
      }

      categoryMap.get(categoryKey).services.push(mapPartnerServiceRow(row));
    }

    const data = Array.from(categoryMap.values());

    return ok(200, {
      message: 'Partner services fetched successfully.',
      data,
    });
  } catch (err) {
    console.error('listPartnerMyServices', err.message);
    return fail(500, 'Internal server error.');
  }
};

const updatePartnerMyServices = async (partnerId, servicesInput) => {
  try {
    const partnerResult = await loadApprovedPartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    const { partnerOid, partner } = partnerResult.data;
    const services = Array.isArray(servicesInput) ? servicesInput : [];
    const seenPartnerServiceIds = new Set();
    const targetServiceIds = new Set();

    for (let i = 0; i < services.length; i++) {
      const item = services[i];
      const rowLabel = `services[${i}]`;

      const idParsed = parseObjectId(item._id, `${rowLabel}._id`);
      if (!idParsed.ok) {
        return fail(400, idParsed.message);
      }
      const idKey = String(idParsed.oid);
      if (seenPartnerServiceIds.has(idKey)) {
        return fail(400, 'Duplicate partner service id in request.');
      }
      seenPartnerServiceIds.add(idKey);

      const categoryParsed = parseObjectId(item.category_id, `${rowLabel}.category_id`);
      if (!categoryParsed.ok) {
        return fail(400, 'Category is required.');
      }

      const serviceParsed = parseObjectId(item.service_id, `${rowLabel}.service_id`);
      if (!serviceParsed.ok) {
        return fail(400, 'Service is required.');
      }

      const priceParsed = parsePrice(item.price);
      if (!priceParsed.ok) {
        return fail(400, priceParsed.message);
      }

      const descriptionParsed = parseDescription(item.description);
      if (!descriptionParsed.ok) {
        return fail(400, descriptionParsed.message);
      }

      const serviceKey = String(serviceParsed.oid);
      if (targetServiceIds.has(serviceKey)) {
        return fail(400, 'Duplicate service in request.');
      }
      targetServiceIds.add(serviceKey);

      const availability = await assertCategoryAndServiceAvailable(
        categoryParsed.oid,
        serviceParsed.oid,
        partner.franchise_id
      );
      if (!availability.ok) {
        return availability;
      }

      const existing = await PartnerService.findOne({
        _id: idParsed.oid,
        partner_id: partnerOid,
        deleted_at: null,
      });

      if (!existing) {
        return fail(404, 'Partner service not found.');
      }

      const duplicateService = await PartnerService.findOne({
        partner_id: partnerOid,
        service_id: serviceParsed.oid,
        deleted_at: null,
        _id: { $ne: idParsed.oid },
      }).select('_id');

      if (duplicateService) {
        return fail(409, 'This service is already added to your catalog.');
      }

      existing.category_id = categoryParsed.oid;
      existing.service_id = serviceParsed.oid;
      existing.price = priceParsed.n;
      existing.description = descriptionParsed.text;
      existing.updated_at = new Date();
      await existing.save();
    }

    await rebuildPartnerCategoriesFromPartnerServices(partnerOid);

    return listPartnerMyServices(partnerId);
  } catch (err) {
    console.error('updatePartnerMyServices', err.message);
    return fail(500, 'Internal server error.');
  }
};

const updateOnePartnerServiceStatus = async (partnerId, partnerServiceId, isActiveInput) => {
  try {
    const partnerResult = await loadApprovedPartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    const { partnerOid } = partnerResult.data;
    const idParsed = parseObjectId(partnerServiceId, 'id');
    if (!idParsed.ok) {
      return fail(400, idParsed.message);
    }

    const activeParsed = parseIsActive(isActiveInput);
    if (!activeParsed.ok) {
      return fail(400, activeParsed.message);
    }

    const existing = await PartnerService.findOne({
      _id: idParsed.oid,
      partner_id: partnerOid,
      deleted_at: null,
    });

    if (!existing) {
      return fail(404, 'Partner service not found.');
    }

    existing.is_active = activeParsed.active;
    existing.updated_at = new Date();
    await existing.save();

    return ok(200, {
      message: 'Service status updated successfully.',
      data: {
        _id: existing._id,
        is_active: existing.is_active !== false,
      },
    });
  } catch (err) {
    console.error('updateOnePartnerServiceStatus', err.message);
    return fail(500, 'Internal server error.');
  }
};

const updateBulkPartnerServiceStatus = async (partnerId, updatesInput) => {
  try {
    const partnerResult = await loadApprovedPartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    const { partnerOid } = partnerResult.data;
    const updates = Array.isArray(updatesInput) ? updatesInput : [];
    const seenIds = new Set();
    const parsedUpdates = [];

    for (let i = 0; i < updates.length; i++) {
      const item = updates[i];
      const rowLabel = `updates[${i}]`;

      const idParsed = parseObjectId(item?._id, `${rowLabel}._id`);
      if (!idParsed.ok) {
        return fail(400, idParsed.message);
      }

      const idKey = String(idParsed.oid);
      if (seenIds.has(idKey)) {
        return fail(400, 'Duplicate partner service id in request.');
      }
      seenIds.add(idKey);

      const activeParsed = parseIsActive(item?.is_active, `${rowLabel}.is_active`);
      if (!activeParsed.ok) {
        return fail(400, activeParsed.message);
      }

      parsedUpdates.push({ oid: idParsed.oid, is_active: activeParsed.active });
    }

    const ids = parsedUpdates.map((u) => u.oid);
    const rows = await PartnerService.find({
      _id: { $in: ids },
      partner_id: partnerOid,
      deleted_at: null,
    });

    if (rows.length !== parsedUpdates.length) {
      return fail(404, 'One or more partner services were not found.');
    }

    const activeById = new Map(parsedUpdates.map((u) => [String(u.oid), u.is_active]));
    const updated = [];
    const now = new Date();

    for (const row of rows) {
      row.is_active = activeById.get(String(row._id));
      row.updated_at = now;
      await row.save();
      updated.push({
        _id: row._id,
        is_active: row.is_active !== false,
      });
    }

    return ok(200, {
      message: 'Service statuses updated successfully.',
      data: { updated },
    });
  } catch (err) {
    console.error('updateBulkPartnerServiceStatus', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listPartnerMyServices,
  updatePartnerMyServices,
  updateOnePartnerServiceStatus,
  updateBulkPartnerServiceStatus,
};
