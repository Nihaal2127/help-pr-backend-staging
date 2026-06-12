const mongoose = require('mongoose');
const User = require('../models/user');
const Franchise = require('../models/franchise');
const { PLAN_NAMES } = require('../models/subscription_plan');
const { USER_TYPE_PARTNER } = require('../constants/user_types');
const {
  listFranchisePartnersPaginated,
  getPartnerProfileForCustomer,
  parsePartnersListQuery,
  paginatePartnerRecords,
  buildFranchisePartnerListRecords,
} = require('./mobile/user/partners_service');

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const comparePlanPriorityDesc = (priorityA, priorityB) => {
  const a = Number(priorityA);
  const b = Number(priorityB);
  const aVal = Number.isFinite(a) ? a : -1;
  const bVal = Number.isFinite(b) ? b : -1;
  return bVal - aVal;
};

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
    return { ok: true, allFranchises: true };
  }
  if (!mongoose.Types.ObjectId.isValid(queryRaw)) {
    return fail(400, 'franchise_id must be a valid ObjectId.');
  }

  return { ok: true, franchiseId: queryRaw };
};

const listAllFranchisesPartnersPaginated = async (query) => {
  try {
    const parsed = parsePartnersListQuery(query);
    if (!parsed.ok) return fail(parsed.status, parsed.message);

    const franchises = await Franchise.find({ deleted_at: null }).select('_id name').lean();

    const merged = [];
    for (const franchise of franchises) {
      const built = await buildFranchisePartnerListRecords(franchise._id);
      if (!built.ok) continue;

      const builtData = built.data || {};
      const records = Array.isArray(builtData.records) ? builtData.records : [];

      for (const record of records) {
        merged.push({
          ...record,
          franchise_id: builtData.franchise_id ?? franchise._id,
          franchise_name: builtData.franchise_name ?? franchise.name ?? null,
        });
      }
    }

    merged.sort((a, b) => {
      const byPlan = comparePlanPriorityDesc(a.plan_priority, b.plan_priority);
      if (byPlan !== 0) return byPlan;
      const byName = String(a.name ?? '').localeCompare(String(b.name ?? ''));
      if (byName !== 0) return byName;
      return String(a.franchise_name ?? '').localeCompare(String(b.franchise_name ?? ''));
    });

    const paginated = paginatePartnerRecords(merged, {
      filters: parsed.filters,
      serviceId: parsed.serviceId,
      categoryId: parsed.categoryId,
      page: parsed.page,
      limit: parsed.limit,
    });

    return ok(200, {
      message: 'Partners fetched successfully.',
      data: {
        franchise_id: null,
        franchise_name: null,
        ...paginated,
      },
    });
  } catch (err) {
    console.error('listAllFranchisesPartnersPaginated', err.message);
    return fail(500, 'Internal server error.');
  }
};

const emptyPartnersBrowseCounts = () => {
  const counts = { total: 0 };
  for (const plan of PLAN_NAMES) {
    counts[plan] = 0;
  }
  return counts;
};

const countPartnersBrowseRecords = (records) => {
  const counts = emptyPartnersBrowseCounts();
  const safeRecords = Array.isArray(records) ? records : [];
  counts.total = safeRecords.length;

  for (const record of safeRecords) {
    const plan = String(record.subscription_plan_name ?? '').trim().toLowerCase();
    if (PLAN_NAMES.includes(plan)) {
      counts[plan] += 1;
    }
  }

  return counts;
};

const collectAllFranchisesPartnerBrowseRecords = async () => {
  const franchises = await Franchise.find({ deleted_at: null }).select('_id name').lean();
  const merged = [];

  for (const franchise of franchises) {
    const built = await buildFranchisePartnerListRecords(franchise._id);
    if (!built.ok) continue;

    const builtData = built.data || {};
    const records = Array.isArray(builtData.records) ? builtData.records : [];
    merged.push(...records);
  }

  return merged;
};

const collectPartnersBrowseRecords = async (scopeResult, queryFranchiseId) => {
  const franchiseResolved = resolveListFranchiseId(scopeResult, queryFranchiseId);
  if (!franchiseResolved.ok) {
    return franchiseResolved;
  }
  if (franchiseResolved.empty) {
    return ok(200, { records: [] });
  }
  if (franchiseResolved.allFranchises) {
    try {
      const records = await collectAllFranchisesPartnerBrowseRecords();
      return ok(200, { records });
    } catch (err) {
      console.error('collectAllFranchisesPartnerBrowseRecords', err.message);
      return fail(500, 'Internal server error.');
    }
  }

  const built = await buildFranchisePartnerListRecords(franchiseResolved.franchiseId);
  if (!built.ok) {
    return built;
  }

  return ok(200, { records: built.data?.records || [] });
};

const getPartnersBrowseCounts = async (scopeResult, query = {}) => {
  try {
    const collected = await collectPartnersBrowseRecords(scopeResult, query.franchise_id);
    if (!collected.ok) {
      return collected;
    }

    return ok(200, {
      message: 'Partner counts fetched successfully.',
      counts: countPartnersBrowseRecords(collected.data.records),
    });
  } catch (err) {
    console.error('getPartnersBrowseCounts', err.message);
    return fail(500, 'Internal server error.');
  }
};

const listPartnersForAdmin = async (scopeResult, query) => {
  const franchiseResolved = resolveListFranchiseId(scopeResult, query.franchise_id);
  if (!franchiseResolved.ok) {
    return franchiseResolved;
  }
  if (franchiseResolved.empty) {
    return emptyPartnersListPayload(query);
  }
  if (franchiseResolved.allFranchises) {
    return listAllFranchisesPartnersPaginated(query);
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
  getPartnersBrowseCounts,
  loadPartnerForAccess,
  getPartnerProfileForAdmin,
};
