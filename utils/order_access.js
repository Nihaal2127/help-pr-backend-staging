const mongoose = require("mongoose");
const User = require("../models/user");
const Franchise = require("../models/franchise");

const USER_TYPE_ADMIN = 1;
const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_CUSTOMER = 4;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

const BACKOFFICE_TYPES = new Set([
  USER_TYPE_ADMIN,
  USER_TYPE_EMPLOYEE,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
]);

const getCallerId = (req) =>
  (req && req.user && (req.user.id || req.user._id)) || null;

const loadCaller = async (req) => {
  const callerId = getCallerId(req);
  if (!callerId || !mongoose.Types.ObjectId.isValid(callerId)) {
    return { ok: false, status: 401, message: "Access denied. Invalid token." };
  }

  const caller = await User.findOne({ _id: callerId, deleted_at: null })
    .select("type franchise_id")
    .lean();

  if (!caller) {
    return { ok: false, status: 401, message: "User not found." };
  }

  return { ok: true, caller, callerId };
};

const resolveCallerFranchiseId = async (caller, callerId) => {
  if (caller.franchise_id) {
    return caller.franchise_id;
  }
  if (Number(caller.type) === USER_TYPE_ADMIN) {
    const franchise = await Franchise.findOne({
      admin_id: callerId,
      deleted_at: null,
    })
      .select("_id")
      .lean();
    return franchise?._id || null;
  }
  return null;
};

const parseOptionalFranchiseQuery = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { ok: true, oid: null };
  }
  const s = String(raw).trim();
  if (!mongoose.Types.ObjectId.isValid(s)) {
    return { ok: false, status: 409, message: "Invalid franchise id." };
  }
  return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const emptyFranchiseFilter = () => ({
  franchise_id: { $in: [] },
});

const nullOrMissingFranchiseClause = () => ({
  $or: [{ franchise_id: null }, { franchise_id: { $exists: false } }],
});

/**
 * User ids tied to a franchise (employees, partners, franchise admin on Franchise.admin_id).
 */
const fetchFranchiseMemberUserIds = async (franchiseOid) => {
  const franchise = await Franchise.findOne({
    _id: franchiseOid,
    deleted_at: null,
  })
    .select("admin_id")
    .lean();

  const orClauses = [{ franchise_id: franchiseOid }];
  if (franchise?.admin_id) {
    orClauses.push({ _id: franchise.admin_id });
  }

  const users = await User.find({
    deleted_at: null,
    $or: orClauses,
  })
    .select("_id")
    .lean();

  return users.map((u) => u._id);
};

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

/**
 * List/count scope from JWT + optional ?franchise_id (same rules as quotes).
 * Super admin & staff: all orders, optional franchise filter.
 * Franchise admin & employee: their franchise + legacy orders (franchise_id null)
 * linked via partner / employee / creator on that franchise.
 */
const resolveOrderListScope = async (req, { franchiseIdFromQuery } = {}) => {
  const callerResult = await loadCaller(req);
  if (!callerResult.ok) return callerResult;

  const { caller, callerId } = callerResult;
  const callerType = Number(caller.type);

  const parsedFranchise = parseOptionalFranchiseQuery(franchiseIdFromQuery);
  if (!parsedFranchise.ok) return parsedFranchise;

  if (
    callerType === USER_TYPE_SUPER_ADMIN ||
    callerType === USER_TYPE_STAFF
  ) {
    if (parsedFranchise.oid) {
      return { ok: true, filter: { franchise_id: parsedFranchise.oid } };
    }
    return { ok: true, filter: {} };
  }

  if (callerType === USER_TYPE_ADMIN || callerType === USER_TYPE_EMPLOYEE) {
    const franchiseOid = await resolveCallerFranchiseId(caller, callerId);
    if (!franchiseOid) {
      return { ok: true, filter: emptyFranchiseFilter(), noFranchise: true };
    }

    if (
      parsedFranchise.oid &&
      parsedFranchise.oid.toString() !== franchiseOid.toString()
    ) {
      return {
        ok: false,
        status: 403,
        message: "You are not allowed to view orders for this franchise.",
      };
    }

    const memberUserIds = await fetchFranchiseMemberUserIds(franchiseOid);
    return {
      ok: true,
      filter: buildFranchiseOrderListFilter(franchiseOid, memberUserIds),
    };
  }

  return {
    ok: false,
    status: 403,
    message: "You are not allowed to access orders.",
  };
};

/**
 * Single-order access for getById / update / delete.
 */
const assertOrderRecordAccess = async (req, order) => {
  if (!order) {
    return { ok: false, status: 404, message: "No record found" };
  }

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
        message: "You are not allowed to access this order.",
      };
    }

    const orderFranchiseId = order.franchise_id?._id ?? order.franchise_id;
    if (
      orderFranchiseId &&
      String(orderFranchiseId) === String(franchiseOid)
    ) {
      return { ok: true };
    }

    const isLegacyUnscoped =
      orderFranchiseId == null ||
      orderFranchiseId === undefined ||
      String(orderFranchiseId).trim() === "";

    if (isLegacyUnscoped) {
      const memberUserIds = await fetchFranchiseMemberUserIds(franchiseOid);
      if (orderMatchesFranchiseMembers(order, memberUserIds)) {
        return { ok: true };
      }
    }

    return {
      ok: false,
      status: 403,
      message: "You are not allowed to access this order.",
    };
  }

  return {
    ok: false,
    status: 403,
    message: "You are not allowed to access this order.",
  };
};

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
