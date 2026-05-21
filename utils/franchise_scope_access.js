const {
  USER_TYPE_ADMIN,
  USER_TYPE_EMPLOYEE,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
} = require("../constants/user_types");
const { loadCaller } = require("./auth_caller");
const {
  resolveCallerFranchiseId,
  parseOptionalFranchiseQuery,
  emptyFranchiseFilter,
} = require("./franchise_caller");

/**
 * Shared list scope: super admin / staff (optional franchise filter);
 * franchise admin / employee (their franchise only).
 *
 * @param {object} req
 * @param {object} options
 * @param {string} [options.franchiseIdFromQuery]
 * @param {string} options.entityLabel - e.g. "orders", "quotes" (for error messages)
 * @param {function} [options.buildAdminFranchiseFilter] - async (franchiseOid) => Mongo filter
 */
const resolveFranchiseListScope = async (
  req,
  { franchiseIdFromQuery, entityLabel, buildAdminFranchiseFilter } = {}
) => {
  const label = entityLabel || "records";
  const callerResult = await loadCaller(req);
  if (!callerResult.ok) return callerResult;

  const { caller, callerId } = callerResult;
  const callerType = Number(caller.type);

  const parsedFranchise = parseOptionalFranchiseQuery(franchiseIdFromQuery);
  if (!parsedFranchise.ok) return parsedFranchise;

  if (callerType === USER_TYPE_SUPER_ADMIN || callerType === USER_TYPE_STAFF) {
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
        message: `You are not allowed to view ${label} for this franchise.`,
      };
    }

    const filter = buildAdminFranchiseFilter
      ? await buildAdminFranchiseFilter(franchiseOid)
      : { franchise_id: franchiseOid };

    return { ok: true, filter };
  }

  return {
    ok: false,
    status: 403,
    message: `You are not allowed to access ${label}.`,
  };
};

/**
 * @param {object} req
 * @param {object|null} record
 * @param {object} options
 * @param {string} options.entityLabel - e.g. "this order" (used in all 403 messages)
 * @param {function} [options.legacyMatchFn] - async (record, franchiseOid) => boolean
 */
const assertFranchiseRecordAccess = async (req, record, options = {}) => {
  const entityLabel = options.entityLabel || "this record";

  if (!record) {
    return { ok: false, status: 404, message: "No record found" };
  }

  const callerResult = await loadCaller(req);
  if (!callerResult.ok) return callerResult;

  const { caller, callerId } = callerResult;
  const callerType = Number(caller.type);

  if (callerType === USER_TYPE_SUPER_ADMIN || callerType === USER_TYPE_STAFF) {
    return { ok: true };
  }

  if (callerType === USER_TYPE_ADMIN || callerType === USER_TYPE_EMPLOYEE) {
    const franchiseOid = await resolveCallerFranchiseId(caller, callerId);
    if (!franchiseOid) {
      return {
        ok: false,
        status: 403,
        message: `You are not allowed to access ${entityLabel}.`,
      };
    }

    const recordFranchiseId = record.franchise_id?._id ?? record.franchise_id;
    if (
      recordFranchiseId &&
      String(recordFranchiseId) === String(franchiseOid)
    ) {
      return { ok: true };
    }

    if (options.legacyMatchFn) {
      const isLegacyUnscoped =
        recordFranchiseId == null ||
        recordFranchiseId === undefined ||
        String(recordFranchiseId).trim() === "";

      if (isLegacyUnscoped && (await options.legacyMatchFn(record, franchiseOid))) {
        return { ok: true };
      }
    }

    return {
      ok: false,
      status: 403,
      message: `You are not allowed to access ${entityLabel}.`,
    };
  }

  return {
    ok: false,
    status: 403,
    message: `You are not allowed to access ${entityLabel}.`,
  };
};

module.exports = {
  resolveFranchiseListScope,
  assertFranchiseRecordAccess,
};
