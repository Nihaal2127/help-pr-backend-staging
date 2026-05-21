const {
  resolveFranchiseListScope,
  assertFranchiseRecordAccess,
} = require("./franchise_scope_access");
const { resolveCallerFranchiseId } = require("./franchise_caller");

const resolveRefundListScope = async (req, { franchiseIdFromQuery } = {}) =>
  resolveFranchiseListScope(req, {
    franchiseIdFromQuery,
    entityLabel: "refunds",
  });

const assertRefundRecordAccess = async (req, record) => {
  if (!record) {
    return { ok: false, status: 404, message: "Refund not found." };
  }

  return assertFranchiseRecordAccess(req, record, {
    entityLabel: "this refund",
  });
};

module.exports = {
  resolveRefundListScope,
  assertRefundRecordAccess,
  resolveCallerFranchiseId,
};
