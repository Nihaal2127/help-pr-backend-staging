const mongoose = require('mongoose');
const CustomerSavedPartner = require('../../../models/customer_saved_partner');
const Area = require('../../../models/area');
const User = require('../../../models/user');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');
const { fieldLabel } = require('../../../utils/field_labels');
const { resolveFranchiseForArea } = require('./franchise_partner_scope');
const {
  parsePartnersListQuery,
  paginatePartnerRecords,
  buildFranchisePartnerListRecords,
} = require('./partners_service');

const { fail, ok } = require('../../../utils/mobile_service_result');

const assertSavablePartner = async (partnerId) => {
  const partnerKey = String(partnerId ?? '').trim();
  if (!partnerKey || !mongoose.Types.ObjectId.isValid(partnerKey)) {
    return fail(400, `${fieldLabel('partnerId')} must be a valid ObjectId.`);
  }

  const partner = await User.findOne({
    _id: partnerKey,
    type: USER_TYPE_PARTNER,
    verification_status: 2,
    is_active: true,
    is_blocked: { $ne: true },
    deleted_at: null,
  })
    .select('_id franchise_id name')
    .lean();

  if (!partner || !partner.franchise_id) {
    return fail(404, 'Partner not found.');
  }

  const built = await buildFranchisePartnerListRecords(partner.franchise_id, {
    partnerIdAllowlist: [partner._id],
    publishedOnly: true,
  });

  if (!built.ok) {
    return fail(built.status, built.message);
  }

  const builtData = built.data || {};
  const builtRecords = Array.isArray(builtData.records) ? builtData.records : [];

  if (!builtRecords.some((row) => String(row._id) === String(partner._id))) {
    return fail(404, 'Partner not found.');
  }

  return ok(200, {
    partner_id: partner._id,
    franchise_id: partner.franchise_id,
    partner_name: partner.name,
  });
};

const savePartnerForCustomer = async (userId, partnerId) => {
  try {
    const eligible = await assertSavablePartner(partnerId);
    if (!eligible.ok) return eligible;

    const userOid = new mongoose.Types.ObjectId(String(userId));
    const { partner_id: partnerOid, franchise_id: franchiseOid } = eligible.data;

    const existing = await CustomerSavedPartner.findOne({
      user_id: userOid,
      partner_id: partnerOid,
    }).lean();

    if (existing) {
      return ok(200, {
        message: 'Partner already saved.',
        data: {
          partner_id: partnerOid,
          franchise_id: existing.franchise_id ?? franchiseOid,
          is_saved: true,
          saved_at: existing.created_at,
        },
      });
    }

    const saved = await CustomerSavedPartner.create({
      user_id: userOid,
      partner_id: partnerOid,
      franchise_id: franchiseOid,
      created_at: new Date(),
    });

    return ok(201, {
      message: 'Partner saved successfully.',
      data: {
        partner_id: partnerOid,
        franchise_id: franchiseOid,
        is_saved: true,
        saved_at: saved.created_at,
      },
    });
  } catch (err) {
    if (err?.code === 11000) {
      return ok(200, {
        message: 'Partner already saved.',
        data: { partner_id: partnerId, is_saved: true },
      });
    }
    console.error('savePartnerForCustomer', err.message);
    return fail(500, 'Internal server error.');
  }
};

const unsavePartnerForCustomer = async (userId, partnerId) => {
  try {
    const partnerKey = String(partnerId ?? '').trim();
    if (!partnerKey || !mongoose.Types.ObjectId.isValid(partnerKey)) {
      return fail(400, `${fieldLabel('partnerId')} must be a valid ObjectId.`);
    }

    const removed = await CustomerSavedPartner.deleteOne({
      user_id: new mongoose.Types.ObjectId(String(userId)),
      partner_id: new mongoose.Types.ObjectId(partnerKey),
    });

    if (removed.deletedCount === 0) {
      return fail(404, 'Saved partner not found.');
    }

    return ok(200, {
      message: 'Partner removed from saved list.',
      data: {
        partner_id: partnerKey,
        is_saved: false,
      },
    });
  } catch (err) {
    console.error('unsavePartnerForCustomer', err.message);
    return fail(500, 'Internal server error.');
  }
};

const emptySavedPartnersData = (page, limit, franchiseId, franchiseName) =>
  ok(200, {
    message: 'Saved partners fetched successfully.',
    data: {
      franchise_id: franchiseId,
      franchise_name: franchiseName,
      partners: [],
      totalItems: 0,
      totalPages: 0,
      currentPage: page,
      limit,
    },
  });

const resolveSavedListFranchise = async (userId) => {
  const customer = await User.findOne({
    _id: userId,
    deleted_at: null,
  })
    .select('area_id')
    .lean();

  if (!customer?.area_id) {
    return { ok: true, franchise: null };
  }

  const area = await Area.findOne({
    _id: customer.area_id,
    deleted_at: null,
  })
    .select('_id state_id city_id')
    .lean();

  if (!area) {
    return { ok: true, franchise: null };
  }

  const franchiseResult = await resolveFranchiseForArea(area);
  if (!franchiseResult.ok) {
    return { ok: true, franchise: null };
  }

  return franchiseResult;
};

const listSavedPartnersPaginated = async (userId, query) => {
  try {
    const parsed = parsePartnersListQuery(query);
    if (!parsed.ok) return fail(parsed.status, parsed.message);

    const { page, limit, filters, serviceId, categoryId } = parsed;

    const franchiseCtx = await resolveSavedListFranchise(userId);
    if (!franchiseCtx.ok) return franchiseCtx;
    if (!franchiseCtx.franchise) {
      return emptySavedPartnersData(page, limit, null, null);
    }

    const franchiseId = franchiseCtx.franchise._id;
    const franchiseName = franchiseCtx.franchise.name ?? null;

    const saves = await CustomerSavedPartner.find({
      user_id: new mongoose.Types.ObjectId(String(userId)),
      franchise_id: franchiseId,
    })
      .sort({ created_at: -1 })
      .lean();

    if (saves.length === 0) {
      return emptySavedPartnersData(page, limit, franchiseId, franchiseName);
    }

    const savedAtByPartnerId = new Map(
      saves.map((row) => [String(row.partner_id), row.created_at])
    );

    const built = await buildFranchisePartnerListRecords(franchiseId, {
      partnerIdAllowlist: saves.map((row) => row.partner_id),
      publishedOnly: true,
    });
    if (!built.ok) return built;

    const builtData = built.data || {};
    const builtRecords = Array.isArray(builtData.records) ? builtData.records : [];
    const merged = builtRecords.map((record) => {
      const partnerKey = String(record._id);
      return {
        ...record,
        franchise_id: builtData.franchise_id,
        franchise_name: franchiseName,
        saved_at: savedAtByPartnerId.get(partnerKey) ?? null,
        is_saved: true,
      };
    });

    merged.sort((a, b) => {
      const ta = a.saved_at ? new Date(a.saved_at).getTime() : 0;
      const tb = b.saved_at ? new Date(b.saved_at).getTime() : 0;
      return tb - ta;
    });

    const paginated = paginatePartnerRecords(merged, {
      filters,
      serviceId,
      categoryId,
      page,
      limit,
    });

    return ok(200, {
      message: 'Saved partners fetched successfully.',
      data: {
        franchise_id: franchiseId,
        franchise_name: franchiseName,
        ...paginated,
      },
    });
  } catch (err) {
    console.error('listSavedPartnersPaginated', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  savePartnerForCustomer,
  unsavePartnerForCustomer,
  listSavedPartnersPaginated,
};
