const mongoose = require("mongoose");
const User = require("../models/user");
const Franchise = require("../models/franchise");

const USER_TYPE_ADMIN = 1;
const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_CUSTOMER = 4;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

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

/**
 * List/count scope from JWT + optional ?franchise_id.
 * Super admin & staff: all quotes, optional franchise filter.
 * Franchise admin & employee: only their franchise (query must match if sent).
 */
const resolveQuoteListScope = async (req, { franchiseIdFromQuery } = {}) => {
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
        message: "You are not allowed to view quotes for this franchise.",
      };
    }

    return { ok: true, filter: { franchise_id: franchiseOid } };
  }

  return {
    ok: false,
    status: 403,
    message: "You are not allowed to access quotes.",
  };
};

/**
 * Single-quote access for getById / update / delete.
 */
const assertQuoteRecordAccess = async (req, quote) => {
  if (!quote) {
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
        message: "You are not allowed to access this quote.",
      };
    }

    const quoteFranchiseId = quote.franchise_id?._id ?? quote.franchise_id;
    if (
      !quoteFranchiseId ||
      String(quoteFranchiseId) !== String(franchiseOid)
    ) {
      return {
        ok: false,
        status: 403,
        message: "You are not allowed to access this quote.",
      };
    }

    return { ok: true };
  }

  return {
    ok: false,
    status: 403,
    message: "You are not allowed to access this quote.",
  };
};

module.exports = {
  resolveQuoteListScope,
  assertQuoteRecordAccess,
  resolveCallerFranchiseId,
};
