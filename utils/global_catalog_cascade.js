const mongoose = require('mongoose');
const Category = require('../models/category');
const Service = require('../models/service');

const toIdStr = (id) => (id ? id.toString() : '');

/**
 * Global catalogue deactivation no longer mutates franchise/partner mapping preferences.
 * Effective availability is computed dynamically by catalog_availability_resolver.
 *
 * @deprecated No-op kept for backward compatibility with older call sites.
 */
const cascadeGlobalCategoryInactive = async (_categoryId) => {
    return { skipped: true, reason: 'resolver_based_availability' };
};

/**
 * @deprecated No-op — see cascadeGlobalCategoryInactive.
 */
const cascadeGlobalServiceInactive = async (_serviceId) => {
    return { skipped: true, reason: 'resolver_based_availability' };
};

/**
 * @deprecated No-op — franchise service preferences are not mutated when franchise categories toggle off.
 */
const cascadeInactiveCategoriesToFranchiseServices = async (_franchiseOid, _inactiveCategoryIds) => {
    return { skipped: true, reason: 'resolver_based_availability' };
};

/**
 * Catalogue ids that count for dashboards/lists (non-deleted, not a pending request row).
 */
const loadEligibleCatalogIdSet = async (rawIds, kind) => {
    const { eligible } = await loadEligibleCatalogMeta(rawIds, kind);
    return eligible;
};

/**
 * Eligible catalogue rows plus which are globally active (is_active: true, is_request: false).
 */
const loadEligibleCatalogMeta = async (rawIds, kind) => {
    const unique = [...new Set((rawIds || []).filter(Boolean).map((id) => toIdStr(id)))];
    const eligible = new Set();
    const globallyActive = new Set();
    if (unique.length === 0) return { eligible, globallyActive };

    const Model = kind === 'category' ? Category : Service;
    const rows = await Model.find({
        _id: { $in: unique },
        deleted_at: null,
        is_request: false,
    })
        .select('_id is_active')
        .lean();

    for (const row of rows) {
        const s = row._id.toString();
        eligible.add(s);
        if (row.is_active) globallyActive.add(s);
    }
    return { eligible, globallyActive };
};

module.exports = {
    cascadeGlobalCategoryInactive,
    cascadeGlobalServiceInactive,
    cascadeInactiveCategoriesToFranchiseServices,
    loadEligibleCatalogIdSet,
    loadEligibleCatalogMeta,
};
