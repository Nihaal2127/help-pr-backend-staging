const mongoose = require('mongoose');
const Franchise = require('../models/franchise');
const Category = require('../models/category');
const Service = require('../models/service');
const User = require('../models/user');
const {
    coerceLegacyCategoryMappingArrays,
    coerceLegacyServiceMappingArrays,
} = require('./franchise_catalog_lists');
const { countFranchiseScopedAvailability } = require('./catalog_availability_resolver');

const KIND_CONFIG = {
    category: {
        CatalogModel: Category,
        franchiseArrayField: 'categories',
        coerce: coerceLegacyCategoryMappingArrays,
    },
    service: {
        CatalogModel: Service,
        franchiseArrayField: 'services',
        coerce: coerceLegacyServiceMappingArrays,
    },
};

/**
 * Latest franchise mapping coerced from categories_list / services_list (local preference).
 * @param {mongoose.Types.ObjectId} franchiseOid
 * @param {'category'|'service'} kind
 */
const resolveLatestCoercedMappingForFranchise = async (franchiseOid, kind) => {
    const { resolveFranchiseMappingPreferenceMaps } = require('./catalog_availability_resolver');
    const local = await resolveFranchiseMappingPreferenceMaps(franchiseOid);
    if (!local.ok) return null;

    const idMap = kind === 'category' ? local.categoryEnabled : local.serviceEnabled;
    const listKey = kind === 'category' ? 'categories_list' : 'services_list';
    const idField = kind === 'category' ? 'category_id' : 'service_id';
    const entries = [...idMap.entries()].map(([id, enabled]) => ({
        [idField]: new mongoose.Types.ObjectId(id),
        is_active: enabled,
    }));

    if (kind === 'category') {
        return coerceLegacyCategoryMappingArrays({
            categories_list: entries,
            categories_order: entries.map((e) => e.category_id),
        });
    }

    return coerceLegacyServiceMappingArrays({
        services_list: entries,
        services_order: entries.map((e) => e.service_id),
    });
};

/** User ids tied to franchises (for requested_* counts and list `requested_by` scope). */
const getFranchiseUserIdsForScope = async (franchiseIdsScope) => {
    if (!franchiseIdsScope || franchiseIdsScope.length === 0) return [];
    return User.find({
        franchise_id: { $in: franchiseIdsScope },
        deleted_at: null,
    }).distinct('_id');
};

/**
 * Pending catalogue requests raised by users under the franchise scope.
 */
const countFranchiseScopedRequestedCatalog = async (franchiseIdsScope, kind) => {
    const cfg = KIND_CONFIG[kind];
    if (!cfg) throw new Error(`Invalid catalog kind: ${kind}`);

    const franchiseUserIds = await getFranchiseUserIdsForScope(franchiseIdsScope);
    if (franchiseUserIds.length === 0) return 0;

    return cfg.CatalogModel.countDocuments({
        deleted_at: null,
        is_request: true,
        requested_by: { $in: franchiseUserIds },
    });
};

/**
 * Resolver-driven franchise dashboard counts.
 * Returns total_assigned, locally_enabled, globally_active, effectively_available per kind.
 */
const countFranchiseScopedCatalogDashboard = async (franchiseIdsScope, kind) => {
    return countFranchiseScopedAvailability(franchiseIdsScope, kind);
};

module.exports = {
    resolveLatestCoercedMappingForFranchise,
    getFranchiseUserIdsForScope,
    countFranchiseScopedRequestedCatalog,
    countFranchiseScopedCatalogDashboard,
};
