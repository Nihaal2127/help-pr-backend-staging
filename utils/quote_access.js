const {
  resolveFranchiseListScope,
  assertFranchiseRecordAccess,
} = require("./franchise_scope_access");
const { resolveCallerFranchiseId } = require("./franchise_caller");

const resolveQuoteListScope = async (req, { franchiseIdFromQuery } = {}) =>
  resolveFranchiseListScope(req, {
    franchiseIdFromQuery,
    entityLabel: "quotes",
  });

const assertQuoteRecordAccess = async (req, quote) =>
  assertFranchiseRecordAccess(req, quote, {
    entityLabel: "this quote",
  });

module.exports = {
  resolveQuoteListScope,
  assertQuoteRecordAccess,
  resolveCallerFranchiseId,
};
