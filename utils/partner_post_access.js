const {
  resolveFranchiseListScope,
} = require('./franchise_scope_access');

const resolvePartnerPostListScope = async (req, { franchiseIdFromQuery } = {}) =>
  resolveFranchiseListScope(req, {
    franchiseIdFromQuery,
    entityLabel: 'partner posts',
  });

module.exports = {
  resolvePartnerPostListScope,
};
