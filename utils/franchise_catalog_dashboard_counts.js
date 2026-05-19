const mongoose = require('mongoose');
const Franchise = require('../models/franchise');
const FranchiseCategory = require('../models/franchise_category');
const FranchiseService = require('../models/franchise_service');
const Category = require('../models/category');
const Service = require('../models/service');
const {
    coerceLegacyCategoryMappingArrays,
    coerceLegacyServiceMappingArrays,
} = require('./franchise_catalog_lists');

const KIND_CONFIG = {
    category: {
        MappingModel: FranchiseCategory,
        CatalogModel: Category,
        activeField: 'active_categories',
        franchiseArrayField: 'categories',
        coerce: coerceLegacyCategoryMappingArrays,
    },
    service: {
        MappingModel: FranchiseService,
        CatalogModel: Service,
        activeField: 'active_services',
        franchiseArrayField: 'services',
        coerce: coerceLegacyServiceMappingArrays,
    },
};

/**
 * Latest franchise_category / franchise_service mapping for one franchise (same as
 * buildAllCategories|ServicesWithFranchiseMappingStatus in mapping list services).
 * Falls back to Franchise.categories / Franchise.services when no mapping row exists.
 * @param {mongoose.Types.ObjectId} franchiseOid
 * @param {'category'|'service'} kind
 * @returns {Promise<object | null>} coerced mapping plain object
 */
const resolveLatestCoercedMappingForFranchise = async (franchiseOid, kind) => {
    const cfg = KIND_CONFIG[kind];
    if (!cfg) throw new Error(`Invalid catalog kind: ${kind}`);

    const row = await cfg.MappingModel.findOne({
        franchise_id: franchiseOid,
        deleted_at: null,
    })
        .sort({ created_at: -1 })
        .lean();

    if (row) return cfg.coerce(row);

    const fr = await Franchise.findOne({ _id: franchiseOid, deleted_at: null })
        .select(cfg.franchiseArrayField)
        .lean();
    const legacyIds = fr && Array.isArray(fr[cfg.franchiseArrayField]) ? fr[cfg.franchiseArrayField] : [];
    if (legacyIds.length === 0) return null;

    if (kind === 'category') {
        return coerceLegacyCategoryMappingArrays({
            active_categories: [...legacyIds],
            inactive_categories: [],
            categories_list: legacyIds.map((category_id) => ({ category_id, is_active: true })),
        });
    }

    return coerceLegacyServiceMappingArrays({
        active_services: [...legacyIds],
        inactive_services: [],
        services_list: legacyIds.map((service_id) => ({ service_id, is_active: true })),
    });
};

/**
 * Dashboard category/service counts for franchise scope — aligned with:
 * - GET franchise-category|service/getAll `all_categories` / `all_services` (global catalogue + franchise_active)
 * - POST /api/getCount types my-franchise & service-management (with franchise_id)
 *
 * total_*     = all non-deleted global catalogue rows
 * active_*    = sum of active_* array lengths on the latest mapping per franchise (legacy fallback included)
 * inactive_*  = max(0, total - active)
 *
 * @param {mongoose.Types.ObjectId[]} franchiseIdsScope
 * @param {'category'|'service'} kind
 */
const countFranchiseScopedCatalogDashboard = async (franchiseIdsScope, kind) => {
    const cfg = KIND_CONFIG[kind];
    if (!cfg) throw new Error(`Invalid catalog kind: ${kind}`);

    if (!franchiseIdsScope || franchiseIdsScope.length === 0) {
        return { total: 0, active: 0, inactive: 0 };
    }

    const total = await cfg.CatalogModel.countDocuments({ deleted_at: null });

    let active = 0;
    for (const franchiseOid of franchiseIdsScope) {
        const coerced = await resolveLatestCoercedMappingForFranchise(franchiseOid, kind);
        if (!coerced) continue;
        active += (coerced[cfg.activeField] || []).length;
    }

    return {
        total,
        active,
        inactive: Math.max(0, total - active),
    };
};

module.exports = {
    resolveLatestCoercedMappingForFranchise,
    countFranchiseScopedCatalogDashboard,
};
