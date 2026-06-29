const {
  resolveFranchiseListScope,
  assertFranchiseRecordAccess,
} = require("./franchise_scope_access");
const { fetchFranchiseMemberUserIds, resolveCallerFranchiseId } = require("./franchise_caller");
const { assertCanEditAdminDescription } = require("./admin_description_access");

const quoteParticipantIds = (quote) =>
  [quote.partner_id, quote.employee_id, quote.created_by_id]
    .filter((x) => x != null)
    .map((x) => String(x._id ?? x));

const quoteMatchesFranchiseMembers = (quote, memberUserIds) => {
  if (!memberUserIds.length) return false;
  const memberSet = new Set(memberUserIds.map((id) => String(id)));
  return quoteParticipantIds(quote).some((id) => memberSet.has(id));
};

/** Legacy quotes (franchise_id null) scoped via partner / employee / creator franchise membership. */
const legacyQuoteMatchFn = async (quote, franchiseOid) => {
  const memberUserIds = await fetchFranchiseMemberUserIds(franchiseOid);
  return quoteMatchesFranchiseMembers(quote, memberUserIds);
};

const resolveQuoteListScope = async (req, { franchiseIdFromQuery } = {}) =>
  resolveFranchiseListScope(req, {
    franchiseIdFromQuery,
    entityLabel: "quotes",
  });

const assertQuoteRecordAccess = async (req, quote) =>
  assertFranchiseRecordAccess(req, quote, {
    entityLabel: "this quote",
    legacyMatchFn: legacyQuoteMatchFn,
  });

const assertCanEditQuoteAdminDescription = async (req, quote) =>
  assertCanEditAdminDescription(req, quote, {
    entityLabel: "this quote",
    legacyMatchFn: legacyQuoteMatchFn,
  });

module.exports = {
  resolveQuoteListScope,
  assertQuoteRecordAccess,
  assertCanEditQuoteAdminDescription,
  legacyQuoteMatchFn,
  resolveCallerFranchiseId,
};
