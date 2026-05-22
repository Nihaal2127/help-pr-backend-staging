const mongoose = require('mongoose');
const Category = require('../models/category');
const Service = require('../models/service');
const {
    onGlobalCategoryDeactivated,
    onGlobalServiceDeactivated,
    onFranchiseCategoriesRemoved,
} = require('../services/catalog_cascade_service');

const toIdStr = (id) => (id ? id.toString() : '');

/**
 * Global category deactivated or deleted — mutates franchise arrays and soft-deletes partner rows.
 */
const cascadeGlobalCategoryInactive = async (categoryId) => onGlobalCategoryDeactivated(categoryId);

/**
 * Global service deactivated or deleted — mutates franchise arrays and soft-deletes partner rows.
 */
const cascadeGlobalServiceInactive = async (serviceId) => onGlobalServiceDeactivated(serviceId);

/**
 * Franchise removed categories — pulls related franchise services and soft-deletes partner rows.
 */
const cascadeInactiveCategoriesToFranchiseServices = async (franchiseOid, inactiveCategoryIds) =>
    onFranchiseCategoriesRemoved(franchiseOid, inactiveCategoryIds);

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
