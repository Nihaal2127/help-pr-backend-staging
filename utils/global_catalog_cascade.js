const mongoose = require('mongoose');
const Category = require('../models/category');
const Service = require('../models/service');
const FranchiseCategory = require('../models/franchise_category');
const FranchiseService = require('../models/franchise_service');
const {
    coerceLegacyCategoryMappingArrays,
    coerceLegacyServiceMappingArrays,
    normalizeStoredCategoriesList,
    normalizeStoredServicesList,
} = require('./franchise_catalog_lists');

const toIdStr = (id) => (id ? id.toString() : '');

/**
 * Move mapped ids from active → inactive while keeping a full partition of the catalog list.
 */
const repartitionMappingActiveInactive = (
    catalogIds,
    activeFieldIds,
    inactiveFieldIds,
    idsToDeactivate
) => {
    const deactivate = new Set((idsToDeactivate || []).map(toIdStr));
    const activeSet = new Set((activeFieldIds || []).map(toIdStr));
    const inactiveSet = new Set((inactiveFieldIds || []).map(toIdStr));

    for (const oid of catalogIds) {
        const s = toIdStr(oid);
        if (deactivate.has(s)) {
            activeSet.delete(s);
            inactiveSet.add(s);
        }
    }

    for (const oid of catalogIds) {
        const s = toIdStr(oid);
        if (!activeSet.has(s) && !inactiveSet.has(s)) {
            if (deactivate.has(s)) inactiveSet.add(s);
            else activeSet.add(s);
        }
    }

    for (const oid of catalogIds) {
        const s = toIdStr(oid);
        if (activeSet.has(s) && inactiveSet.has(s)) {
            if (deactivate.has(s)) activeSet.delete(s);
            else inactiveSet.delete(s);
        }
    }

    return {
        active: catalogIds.filter((id) => activeSet.has(toIdStr(id))),
        inactive: catalogIds.filter((id) => inactiveSet.has(toIdStr(id))),
        activeSet,
    };
};

const franchiseCategoryMappingQuery = (categoryOid) => ({
    deleted_at: null,
    $or: [{ 'categories_list.category_id': categoryOid }, { categories_list: categoryOid }],
});

const franchiseServiceMappingQuery = (serviceOids) => ({
    deleted_at: null,
    $or: [
        { 'services_list.service_id': { $in: serviceOids } },
        { services_list: { $in: serviceOids } },
    ],
});

/**
 * When franchise mapping marks categories inactive, related franchise services must follow.
 */
const cascadeInactiveCategoriesToFranchiseServices = async (franchiseOid, inactiveCategoryIds) => {
    const inactiveCat = new Set((inactiveCategoryIds || []).map(toIdStr));
    if (inactiveCat.size === 0) return;

    const fsDocs = await FranchiseService.find({ franchise_id: franchiseOid, deleted_at: null });
    if (!fsDocs || fsDocs.length === 0) return;

    const allSvcOids = [];
    for (const d of fsDocs) {
        const norm = normalizeStoredServicesList(d.services_list);
        for (const e of norm) {
            if (e.service_id) allSvcOids.push(e.service_id);
        }
    }
    if (allSvcOids.length === 0) return;

    const svcRows = await Service.find({
        _id: { $in: allSvcOids },
        deleted_at: null,
    })
        .select('category_id')
        .lean();
    const svcCategoryById = new Map(
        svcRows.map((s) => [s._id.toString(), s.category_id ? s.category_id.toString() : ''])
    );

    const serviceIdsToDeactivate = [];
    for (const sid of allSvcOids) {
        const cat = svcCategoryById.get(sid.toString());
        if (cat && inactiveCat.has(cat)) serviceIdsToDeactivate.push(sid);
    }
    if (serviceIdsToDeactivate.length === 0) return;

    await deactivateServicesInFranchiseMappings(franchiseOid, serviceIdsToDeactivate);
};

const deactivateServicesInFranchiseMappings = async (franchiseOid, serviceIds) => {
    const deactivate = new Set((serviceIds || []).map(toIdStr));
    if (deactivate.size === 0) return;

    const filter = { deleted_at: null, ...franchiseServiceMappingQuery(serviceIds) };
    if (franchiseOid) filter.franchise_id = franchiseOid;

    const fsDocs = await FranchiseService.find(filter);
    for (const doc of fsDocs) {
        const norm = normalizeStoredServicesList(doc.services_list);
        const catalogIds = norm.map((e) => e.service_id);
        if (catalogIds.length === 0) continue;

        const { active, inactive, activeSet } = repartitionMappingActiveInactive(
            catalogIds,
            doc.active_services,
            doc.inactive_services,
            serviceIds
        );

        doc.services_list = norm.map((e) => ({
            service_id: e.service_id,
            is_active: activeSet.has(toIdStr(e.service_id)),
        }));
        doc.active_services = active;
        doc.inactive_services = inactive;
        doc.updated_at = new Date();
        await doc.save();
    }
};

const deactivateCategoryInFranchiseMappings = async (categoryOid) => {
    const catStr = toIdStr(categoryOid);
    const fcDocs = await FranchiseCategory.find(franchiseCategoryMappingQuery(categoryOid));

    for (const doc of fcDocs) {
        const norm = normalizeStoredCategoriesList(doc.categories_list);
        const catalogIds = norm.map((e) => e.category_id);
        if (!catalogIds.some((id) => toIdStr(id) === catStr)) continue;

        const { active, inactive, activeSet } = repartitionMappingActiveInactive(
            catalogIds,
            doc.active_categories,
            doc.inactive_categories,
            [categoryOid]
        );

        doc.categories_list = norm.map((e) => ({
            category_id: e.category_id,
            is_active: activeSet.has(toIdStr(e.category_id)),
        }));
        doc.active_categories = active;
        doc.inactive_categories = inactive;
        doc.updated_at = new Date();
        await doc.save();

        await cascadeInactiveCategoriesToFranchiseServices(doc.franchise_id, [categoryOid]);
    }
};

/**
 * Global category deactivated: deactivate its services and sync all franchise mappings.
 */
const cascadeGlobalCategoryInactive = async (categoryId) => {
    const categoryOid =
        categoryId instanceof mongoose.Types.ObjectId
            ? categoryId
            : new mongoose.Types.ObjectId(categoryId);
    const now = new Date();

    await Service.updateMany(
        { category_id: categoryOid, deleted_at: null, is_request: false },
        { $set: { is_active: false, updated_at: now } }
    );

    const serviceIds = await Service.find({
        category_id: categoryOid,
        deleted_at: null,
        is_request: false,
    }).distinct('_id');

    await deactivateCategoryInFranchiseMappings(categoryOid);

    if (serviceIds.length > 0) {
        await deactivateServicesInFranchiseMappings(null, serviceIds);
    }
};

/**
 * Global service deactivated: sync franchise_service mappings.
 */
const cascadeGlobalServiceInactive = async (serviceId) => {
    const serviceOid =
        serviceId instanceof mongoose.Types.ObjectId
            ? serviceId
            : new mongoose.Types.ObjectId(serviceId);

    await deactivateServicesInFranchiseMappings(null, [serviceOid]);
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
    const unique = [
        ...new Set((rawIds || []).filter(Boolean).map((id) => toIdStr(id))),
    ];
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
