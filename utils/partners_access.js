const {
  resolveFranchiseListScope,
  assertFranchiseRecordAccess,
} = require('./franchise_scope_access');

const resolvePartnersListScope = async (req, { franchiseIdFromQuery } = {}) =>
  resolveFranchiseListScope(req, {
    franchiseIdFromQuery,
    entityLabel: 'partners',
  });

const assertPartnersRecordAccess = async (req, partner) => {
  if (!partner) {
    return { ok: false, status: 404, message: 'Partner not found.' };
  }

  return assertFranchiseRecordAccess(req, partner, {
    entityLabel: 'this partner',
  });
};

module.exports = {
  resolvePartnersListScope,
  assertPartnersRecordAccess,
};
