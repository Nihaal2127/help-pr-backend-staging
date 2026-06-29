const { loadCaller } = require("./auth_caller");
const { assertFranchiseRecordAccess } = require("./franchise_scope_access");
const {
  USER_TYPE_ADMIN,
  USER_TYPE_EMPLOYEE,
  USER_TYPE_PARTNER,
  USER_TYPE_CUSTOMER,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
} = require("../constants/user_types");

const MAX_ADMIN_DESCRIPTION_LEN = 1000;

const normalizeAdminDescription = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const validateAdminDescriptionValue = (adminDescription) => {
  if (adminDescription === undefined) return { ok: true };
  if (adminDescription === null) return { ok: true };
  if (typeof adminDescription !== "string") {
    return {
      ok: false,
      message: "Admin description must be a string or null.",
    };
  }
  if (adminDescription.trim().length > MAX_ADMIN_DESCRIPTION_LEN) {
    return {
      ok: false,
      message: `Admin description must be ${MAX_ADMIN_DESCRIPTION_LEN} characters or fewer.`,
    };
  }
  return { ok: true };
};

/**
 * Super admin, staff, or franchise-scoped admin/employee on the record.
 */
const assertCanEditAdminDescription = async (req, record, options = {}) => {
  const callerResult = await loadCaller(req);
  if (!callerResult.ok) return callerResult;

  const callerType = Number(callerResult.caller.type);
  if (callerType === USER_TYPE_SUPER_ADMIN || callerType === USER_TYPE_STAFF) {
    return { ok: true };
  }

  if (callerType === USER_TYPE_ADMIN || callerType === USER_TYPE_EMPLOYEE) {
    return assertFranchiseRecordAccess(req, record, {
      entityLabel: options.entityLabel || "admin description on this record",
      legacyMatchFn: options.legacyMatchFn,
    });
  }

  return {
    ok: false,
    status: 403,
    message:
      "Only super admin, staff, franchise admin, or franchise employee can edit admin description.",
  };
};

const shouldHideAdminDescriptionFromCaller = (req) => {
  const callerType = Number(req?.user?.type);
  return callerType === USER_TYPE_CUSTOMER || callerType === USER_TYPE_PARTNER;
};

const stripAdminDescriptionForPublicApi = (record) => {
  if (!record || typeof record !== "object") return record;
  const plain =
    typeof record.toObject === "function"
      ? record.toObject({ virtuals: true })
      : { ...record };
  delete plain.admin_description;
  if (plain.quote_info && typeof plain.quote_info === "object") {
    delete plain.quote_info.admin_description;
  }
  return plain;
};

const formatRecordsForCaller = (records, req) => {
  if (!shouldHideAdminDescriptionFromCaller(req)) return records;
  if (Array.isArray(records)) {
    return records.map(stripAdminDescriptionForPublicApi);
  }
  return stripAdminDescriptionForPublicApi(records);
};

module.exports = {
  MAX_ADMIN_DESCRIPTION_LEN,
  normalizeAdminDescription,
  validateAdminDescriptionValue,
  assertCanEditAdminDescription,
  shouldHideAdminDescriptionFromCaller,
  stripAdminDescriptionForPublicApi,
  formatRecordsForCaller,
};
