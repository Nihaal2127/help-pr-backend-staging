const mongoose = require('mongoose');
const User = require('../models/user');
const { USER_TYPE_PARTNER } = require('../constants/user_types');
const {
  listFranchisePartnersPaginated,
  getPartnerProfileForCustomer,
} = require('./mobile/user/partners_service');

const fail = (status, message) => ({ ok: false, status, message });

const extractScopedFranchiseId = (scopeFilter = {}) => {
  const franchiseId = scopeFilter.franchise_id;
  if (!franchiseId || franchiseId.$in) {
    return null;
  }
  return String(franchiseId);
};

const emptyPartnersListPayload = (query) => ({
  ok: true,
  status: 200,
  data: {
    message: 'Partners fetched successfully.',
    data: {
      franchise_id: null,
      franchise_name: null,
      partners: [],
      totalItems: 0,
      totalPages: 0,
      currentPage: parseInt(query.page, 10) > 0 ? parseInt(query.page, 10) : 1,
      limit: parseInt(query.limit, 10) > 0 ? parseInt(query.limit, 10) : 10,
    },
  },
});

const resolveListFranchiseId = (scopeResult, queryFranchiseId) => {
  if (scopeResult.noFranchise) {
    return { ok: true, empty: true };
  }

  const scopedFranchiseId = extractScopedFranchiseId(scopeResult.filter);
  if (scopedFranchiseId) {
    return { ok: true, franchiseId: scopedFranchiseId };
  }

  const queryRaw =
    queryFranchiseId !== undefined && queryFranchiseId !== null
      ? String(queryFranchiseId).trim()
      : '';
  if (!queryRaw) {
    return fail(400, 'franchise_id is required.');
  }
  if (!mongoose.Types.ObjectId.isValid(queryRaw)) {
    return fail(400, 'franchise_id must be a valid ObjectId.');
  }

  return { ok: true, franchiseId: queryRaw };
};

const listPartnersForAdmin = async (scopeResult, query) => {
  const franchiseResolved = resolveListFranchiseId(scopeResult, query.franchise_id);
  if (!franchiseResolved.ok) {
    return franchiseResolved;
  }
  if (franchiseResolved.empty) {
    return emptyPartnersListPayload(query);
  }

  return listFranchisePartnersPaginated({
    ...query,
    franchise_id: franchiseResolved.franchiseId,
  });
};

const loadPartnerForAccess = async (partnerIdRaw) => {
  const partnerKey = String(partnerIdRaw ?? '').trim();
  if (!partnerKey || !mongoose.Types.ObjectId.isValid(partnerKey)) {
    return fail(400, 'partnerId must be a valid ObjectId.');
  }

  const partner = await User.findOne({
    _id: partnerKey,
    type: USER_TYPE_PARTNER,
    deleted_at: null,
  })
    .select('_id franchise_id')
    .lean();

  if (!partner) {
    return fail(404, 'Partner not found.');
  }

  return { ok: true, partner };
};

const getPartnerProfileForAdmin = async (partnerId, franchiseId) =>
  getPartnerProfileForCustomer(partnerId, franchiseId, null);

module.exports = {
  listPartnersForAdmin,
  loadPartnerForAccess,
  getPartnerProfileForAdmin,
};
