/**
 * Franchise/partner catalog resolution — re-exports resolver-based effective availability.
 * @see utils/catalog_availability_resolver.js
 */
const {
    resolveFranchiseCatalogByFranchiseId,
    resolvePartnerFranchiseCatalog,
    resolveFranchiseEffectiveCatalog,
    resolvePartnerEffectiveCatalog,
    resolveFranchiseMappingPreferenceMaps,
    resolveFranchiseAssignedEnabledMaps,
    resolveFranchiseLocalEnabledMaps,
} = require('./catalog_availability_resolver');

module.exports = {
    resolveFranchiseCatalogByFranchiseId,
    resolvePartnerFranchiseCatalog,
    resolveFranchiseEffectiveCatalog,
    resolvePartnerEffectiveCatalog,
    resolveFranchiseMappingPreferenceMaps,
    resolveFranchiseAssignedEnabledMaps,
    resolveFranchiseLocalEnabledMaps,
};
