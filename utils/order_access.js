const mongoose = require("mongoose");
const User = require("../models/user");
const {
  USER_TYPE_ADMIN,
  USER_TYPE_EMPLOYEE,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
  BACKOFFICE_TYPES,
} = require("../constants/user_types");
const { getCallerId, loadCaller } = require("./auth_caller");
const {
  resolveCallerFranchiseId,
  nullOrMissingFranchiseClause,
  fetchFranchiseMemberUserIds,
} = require("./franchise_caller");
const {
  resolveFranchiseListScope,
  assertFranchiseRecordAccess,
} = require("./franchise_scope_access");
const {
  assertCanEditAdminDescription,
} = require("./admin_description_access");

/**
 * List filter: explicit franchise_id OR legacy rows (franchise_id null) whose
 * partner / employee / creator belongs to this franchise.
 */
const buildFranchiseOrderListFilter = (franchiseOid, memberUserIds) => {
  if (!memberUserIds.length) {
    return { franchise_id: franchiseOid };
  }

  return {
    $or: [
      { franchise_id: franchiseOid },
      {
        $and: [
          nullOrMissingFranchiseClause(),
          {
            $or: [
              { partner_id: { $in: memberUserIds } },
              { employee_id: { $in: memberUserIds } },
              { created_by_id: { $in: memberUserIds } },
            ],
          },
        ],
      },
    ],
  };
};

const orderParticipantIds = (order) =>
  [order.partner_id, order.employee_id, order.created_by_id]
    .filter((x) => x != null)
    .map((x) => String(x._id ?? x));

const orderMatchesFranchiseMembers = (order, memberUserIds) => {
  if (!memberUserIds.length) return false;
  const memberSet = new Set(memberUserIds.map((id) => String(id)));
  return orderParticipantIds(order).some((id) => memberSet.has(id));
};

const legacyOrderMatchFn = async (order, franchiseOid) => {
  const memberUserIds = await fetchFranchiseMemberUserIds(franchiseOid);
  return orderMatchesFranchiseMembers(order, memberUserIds);
};

/**
 * Resolve franchise_id on create when the client omits it.
 */
const resolveOrderFranchiseIdForCreate = async ({
  franchiseIdFromBody,
  partnerId,
  createdById,
  quoteFranchiseId,
  callerFranchiseId,
  callerType,
}) => {
  if (
    franchiseIdFromBody !== undefined &&
    franchiseIdFromBody !== null &&
    String(franchiseIdFromBody).trim() !== ""
  ) {
    if (!mongoose.Types.ObjectId.isValid(String(franchiseIdFromBody).trim())) {
      return null;
    }
    return new mongoose.Types.ObjectId(String(franchiseIdFromBody).trim());
  }

  if (quoteFranchiseId && mongoose.Types.ObjectId.isValid(String(quoteFranchiseId))) {
    return new mongoose.Types.ObjectId(String(quoteFranchiseId));
  }

  if (partnerId && mongoose.Types.ObjectId.isValid(String(partnerId))) {
    const partner = await User.findOne({
      _id: partnerId,
      deleted_at: null,
    })
      .select("franchise_id")
      .lean();
    if (partner?.franchise_id) {
      return partner.franchise_id;
    }
  }

  if (createdById && mongoose.Types.ObjectId.isValid(String(createdById))) {
    const creator = await User.findOne({
      _id: createdById,
      deleted_at: null,
    })
      .select("type franchise_id")
      .lean();
    if (creator) {
      const fromCreator = await resolveCallerFranchiseId(creator, createdById);
      if (fromCreator) return fromCreator;
    }
  }

  const ct = Number(callerType);
  if (
    callerFranchiseId &&
    mongoose.Types.ObjectId.isValid(String(callerFranchiseId)) &&
    (ct === USER_TYPE_ADMIN || ct === USER_TYPE_EMPLOYEE)
  ) {
    return new mongoose.Types.ObjectId(String(callerFranchiseId));
  }

  return null;
};

/**
 * Back-office only: super admin, staff, franchise admin, employee (from JWT user id → DB).
 */
const assertCallerCanManageOrders = async (req) => {
  const callerResult = await loadCaller(req);
  if (!callerResult.ok) return callerResult;

  const callerType = Number(callerResult.caller.type);
  if (BACKOFFICE_TYPES.has(callerType)) {
    return { ok: true, ...callerResult };
  }

  return {
    ok: false,
    status: 403,
    message:
      "Super admin, staff, franchise admin, or employee access is required.",
  };
};

/**
 * Franchise admin/employee may only assign their franchise; super admin/staff any.
 */
const assertCallerCanAssignFranchise = async (req, franchiseIdToAssign) => {
  const callerResult = await loadCaller(req);
  if (!callerResult.ok) return callerResult;

  const { caller, callerId } = callerResult;
  const callerType = Number(caller.type);

  if (
    callerType === USER_TYPE_SUPER_ADMIN ||
    callerType === USER_TYPE_STAFF
  ) {
    return { ok: true };
  }

  if (callerType === USER_TYPE_ADMIN || callerType === USER_TYPE_EMPLOYEE) {
    const franchiseOid = await resolveCallerFranchiseId(caller, callerId);
    if (!franchiseOid) {
      return {
        ok: false,
        status: 403,
        message: "Your account is not linked to a franchise.",
      };
    }

    const assignId = franchiseIdToAssign?._id ?? franchiseIdToAssign;
    if (!assignId) {
      return {
        ok: false,
        status: 403,
        message: "Orders must belong to your franchise.",
      };
    }

    if (String(assignId) !== String(franchiseOid)) {
      return {
        ok: false,
        status: 403,
        message: "You cannot assign orders to another franchise.",
      };
    }

    return { ok: true };
  }

  return {
    ok: false,
    status: 403,
    message: "You are not allowed to manage orders for this franchise.",
  };
};

const resolveOrderListScope = async (req, { franchiseIdFromQuery } = {}) =>
  resolveFranchiseListScope(req, {
    franchiseIdFromQuery,
    entityLabel: "orders",
    buildAdminFranchiseFilter: async (franchiseOid) => {
      const memberUserIds = await fetchFranchiseMemberUserIds(franchiseOid);
      return buildFranchiseOrderListFilter(franchiseOid, memberUserIds);
    },
  });

const assertOrderRecordAccess = async (req, order) =>
  assertFranchiseRecordAccess(req, order, {
    entityLabel: "this order",
    legacyMatchFn: legacyOrderMatchFn,
  });

const assertCanEditOrderAdminDescription = async (req, order) =>
  assertCanEditAdminDescription(req, order, {
    entityLabel: "this order",
    legacyMatchFn: legacyOrderMatchFn,
  });

/**
 * Back-office franchise access, or direct participant (e.g. partner on the order).
 */
const assertOrderModifyAccess = async (req, order) => {
  const recordAccess = await assertOrderRecordAccess(req, order);
  if (recordAccess.ok) return recordAccess;

  const callerId = getCallerId(req);
  if (callerMatchesOrderParticipant(callerId, order)) {
    return { ok: true };
  }

  return recordAccess;
};

/**
 * True if the authenticated user is a direct participant on the order
 * (customer, partner, creator, or assigned employee).
 */
const callerMatchesOrderParticipant = (reqUserId, order) => {
  if (!reqUserId || !order) return false;
  const uid = String(reqUserId);
  const ids = [order.user_id, order.partner_id, order.created_by_id, order.employee_id]
    .filter((x) => x != null)
    .map((x) => String(x));
  return ids.includes(uid);
};

module.exports = {
  resolveOrderListScope,
  assertOrderRecordAccess,
  assertCanEditOrderAdminDescription,
  assertCallerCanManageOrders,
  assertCallerCanAssignFranchise,
  assertOrderModifyAccess,
  callerMatchesOrderParticipant,
  resolveCallerFranchiseId,
  resolveOrderFranchiseIdForCreate,
  fetchFranchiseMemberUserIds,
  buildFranchiseOrderListFilter,
  getCallerId,
};
