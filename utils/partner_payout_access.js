const {
  resolveFranchiseListScope,
  assertFranchiseRecordAccess,
} = require("./franchise_scope_access");
const { resolveCallerFranchiseId } = require("./franchise_caller");

const resolvePartnerPayoutListScope = async (req, { franchiseIdFromQuery } = {}) =>
  resolveFranchiseListScope(req, {
    franchiseIdFromQuery,
    entityLabel: "partner payouts",
  });

const assertPartnerRecordAccess = async (req, partner) => {
  if (!partner) {
    return { ok: false, status: 404, message: "Partner not found." };
  }

  return assertFranchiseRecordAccess(req, partner, {
    entityLabel: "this partner",
  });
};

module.exports = {
  resolvePartnerPayoutListScope,
  assertPartnerRecordAccess,
  resolveCallerFranchiseId,
};
