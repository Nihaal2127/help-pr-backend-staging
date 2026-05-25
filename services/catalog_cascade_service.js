const mongoose = require('mongoose');
const Category = require('../models/category');
const Service = require('../models/service');
const Franchise = require('../models/franchise');
const PartnerCategory = require('../models/partner_category');
const PartnerService = require('../models/partner_service');
const User = require('../models/user');

const USER_TYPE_PARTNER = 2;

const toIdStr = (id) => (id ? id.toString() : '');

const coerceOid = (id) => {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    const s = String(id).trim();
    if (!mongoose.isValidObjectId(s)) return null;
    return new mongoose.Types.ObjectId(s);
};

const now = () => new Date();

/** Globally visible catalogue row (matches catalog_availability_resolver). */
const isGlobalCatalogRowActive = (doc) =>
    Boolean(doc && doc.deleted_at == null && doc.is_active === true && doc.is_request !== true);

/**
 * A global service may be active only when its parent category is globally active (not inactive / pending / deleted).
 */
const validateGlobalServiceActivation = async ({ categoryId, isActive, isRequest }) => {
    if (isActive !== true || isRequest === true) {
        return { ok: true };
    }

    const catOid = coerceOid(categoryId);
    if (!catOid) {
        return {
            ok: false,
            status: 400,
            message: 'Category is required to activate a service.',
        };
    }

    const category = await Category.findOne({ _id: catOid, deleted_at: null }).lean();
    if (!category) {
        return { ok: false, status: 404, message: 'Category not found.' };
    }

    if (!isGlobalCatalogRowActive(category)) {
        return {
            ok: false,
            status: 400,
            message:
                'Cannot activate a service while its category is inactive, pending approval, or deleted. Activate the category first.',
        };
    }

    return { ok: true };
};

/**
 * Category/service ids removed from a franchise enablement array (before → after).
 */
const diffRemovedIds = (beforeIds, afterIds) => {
    const afterSet = new Set((afterIds || []).map(toIdStr).filter(Boolean));
    return (beforeIds || []).filter((id) => {
        const key = toIdStr(id);
        return key && !afterSet.has(key);
    });
};

const dedupeOids = (ids) => {
    const seen = new Set();
    const out = [];
    for (const id of ids || []) {
        const oid = coerceOid(id);
        if (!oid) continue;
        const key = oid.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(oid);
    }
    return out;
};

/** Service ids linked via service.category_id and/or category.services[] membership. */
const loadServiceIdsForCategories = async (categoryIds) => {
    const oids = (categoryIds || []).map(coerceOid).filter(Boolean);
    if (oids.length === 0) return [];

    const [serviceRows, categoryRows] = await Promise.all([
        Service.find({
            category_id: { $in: oids },
            deleted_at: null,
        })
            .select('_id')
            .lean(),
        Category.find({ _id: { $in: oids }, deleted_at: null }).select('services').lean(),
    ]);

    const fromCategoryArrays = categoryRows.flatMap((row) => row.services || []);
    return dedupeOids([...serviceRows.map((row) => row._id), ...fromCategoryArrays]);
};

/**
 * Remove service ids from franchise.services[] using app-side filtering (ObjectId/string-safe).
 */
const removeServicesFromFranchiseArrays = async (serviceIds, franchiseFilter = { deleted_at: null }) => {
    const removeSet = new Set(
        (serviceIds || []).map(coerceOid).filter(Boolean).map((oid) => oid.toString())
    );
    if (removeSet.size === 0) return { franchisesUpdated: 0 };

    const oidList = [...removeSet].map((id) => new mongoose.Types.ObjectId(id));
    const franchises = await Franchise.find({
        ...franchiseFilter,
        services: { $in: oidList },
    }).select('_id services');

    const ts = now();
    const bulkOps = [];

    for (const franchise of franchises) {
        const before = franchise.services || [];
        const next = before.filter((sid) => !removeSet.has(toIdStr(sid)));
        if (next.length === before.length) continue;
        bulkOps.push({
            updateOne: {
                filter: { _id: franchise._id },
                update: { $set: { services: next, updated_at: ts } },
            },
        });
    }

    if (bulkOps.length > 0) {
        await Franchise.bulkWrite(bulkOps);
    }

    return { franchisesUpdated: bulkOps.length };
};

/** After category membership changes, drop orphan services on every franchise document. */
const syncAllFranchiseServicesToEnabledCategories = async () => {
    const { filterServiceIdsToFranchiseEnabledCategories } = require('../utils/franchise_catalog_from_franchise');
    const franchises = await Franchise.find({ deleted_at: null }).select('_id categories services');
    const ts = now();
    const bulkOps = [];

    for (const franchise of franchises) {
        const pruned = await filterServiceIdsToFranchiseEnabledCategories(
            franchise.categories || [],
            franchise.services || []
        );
        const before = (franchise.services || []).map(toIdStr);
        const after = pruned.map(toIdStr);
        if (before.length === after.length && before.every((id, i) => id === after[i])) {
            continue;
        }
        bulkOps.push({
            updateOne: {
                filter: { _id: franchise._id },
                update: { $set: { services: pruned, updated_at: ts } },
            },
        });
    }

    if (bulkOps.length > 0) {
        await Franchise.bulkWrite(bulkOps);
    }

    return { franchisesUpdated: bulkOps.length };
};

const loadPartnerIdsForFranchise = async (franchiseId) => {
    const fid = coerceOid(franchiseId);
    if (!fid) return [];
    const rows = await User.find({
        franchise_id: fid,
        type: USER_TYPE_PARTNER,
        deleted_at: null,
    })
        .select('_id')
        .lean();
    return rows.map((r) => r._id);
};

const softDeletePartnerCategories = async (filter) => {
    const ts = now();
    return PartnerCategory.updateMany(
        { ...filter, deleted_at: null },
        { $set: { deleted_at: ts, updated_at: ts } }
    );
};

const softDeletePartnerServices = async (filter) => {
    const ts = now();
    return PartnerService.updateMany(
        { ...filter, deleted_at: null },
        { $set: { deleted_at: ts, updated_at: ts } }
    );
};

/**
 * Global category deactivated or soft-deleted: deactivate child services, prune franchise
 * arrays, soft-delete partner catalog rows. No restore on re-activation.
 */
const onGlobalCategoryDeactivated = async (categoryId) => {
    const catOid = coerceOid(categoryId);
    if (!catOid) return { ok: false, reason: 'invalid_category_id' };

    const ts = now();
    const serviceIds = await loadServiceIdsForCategories([catOid]);

    await Service.updateMany(
        { category_id: catOid, deleted_at: null },
        { $set: { is_active: false, updated_at: ts } }
    );

    await Franchise.updateMany(
        { deleted_at: null },
        { $pull: { categories: catOid }, $set: { updated_at: ts } }
    );

    const franchiseServicePrune = await removeServicesFromFranchiseArrays(serviceIds);
    await syncAllFranchiseServicesToEnabledCategories();

    await softDeletePartnerCategories({ category_id: catOid });

    if (serviceIds.length > 0) {
        await softDeletePartnerServices({
            $or: [{ category_id: catOid }, { service_id: { $in: serviceIds } }],
        });
    } else {
        await softDeletePartnerServices({ category_id: catOid });
    }

    return {
        ok: true,
        categoryId: catOid.toString(),
        servicesDeactivated: serviceIds.length,
        franchisesServicesPruned: franchiseServicePrune.franchisesUpdated,
    };
};

/**
 * Global service deactivated or soft-deleted: prune franchise arrays, soft-delete partner rows.
 */
const onGlobalServiceDeactivated = async (serviceId) => {
    const svcOid = coerceOid(serviceId);
    if (!svcOid) return { ok: false, reason: 'invalid_service_id' };

    const ts = now();
    await removeServicesFromFranchiseArrays([svcOid]);

    await softDeletePartnerServices({ service_id: svcOid });

    await PartnerCategory.updateMany(
        { deleted_at: null, services: svcOid },
        { $pull: { services: svcOid }, $set: { updated_at: ts } }
    );

    return { ok: true, serviceId: svcOid.toString() };
};

/**
 * Franchise disabled categories: pull child services from franchise.services, soft-delete
 * partner rows for partners linked to this franchise only.
 */
const onFranchiseCategoriesRemoved = async (franchiseId, removedCategoryIds) => {
    const fid = coerceOid(franchiseId);
    const removed = (removedCategoryIds || []).map(coerceOid).filter(Boolean);
    if (!fid || removed.length === 0) {
        return { ok: true, skipped: true, reason: 'nothing_to_cascade' };
    }

    const serviceIds = await loadServiceIdsForCategories(removed);
    const partnerIds = await loadPartnerIdsForFranchise(fid);

    await removeServicesFromFranchiseArrays(serviceIds, { _id: fid, deleted_at: null });

    const { filterServiceIdsToFranchiseEnabledCategories, catalogIdArraysEqual } = require('../utils/franchise_catalog_from_franchise');
    const franchiseDoc = await Franchise.findOne({ _id: fid, deleted_at: null }).select('categories services');
    if (franchiseDoc) {
        const pruned = await filterServiceIdsToFranchiseEnabledCategories(
            franchiseDoc.categories || [],
            franchiseDoc.services || []
        );
        if (!catalogIdArraysEqual(franchiseDoc.services, pruned)) {
            franchiseDoc.services = pruned;
            franchiseDoc.updated_at = now();
            await franchiseDoc.save();
        }
    }

    if (partnerIds.length === 0) {
        return { ok: true, franchiseId: fid.toString(), partnerRowsSkipped: true };
    }

    await softDeletePartnerCategories({
        partner_id: { $in: partnerIds },
        category_id: { $in: removed },
    });

    const psFilter = {
        partner_id: { $in: partnerIds },
        $or: [{ category_id: { $in: removed } }],
    };
    if (serviceIds.length > 0) {
        psFilter.$or.push({ service_id: { $in: serviceIds } });
    }
    await softDeletePartnerServices(psFilter);

    return {
        ok: true,
        franchiseId: fid.toString(),
        removedCategories: removed.length,
        servicesPruned: serviceIds.length,
        partnersAffected: partnerIds.length,
    };
};

/**
 * Franchise disabled services: soft-delete matching partner_service rows for this franchise's partners.
 */
const onFranchiseServicesRemoved = async (franchiseId, removedServiceIds) => {
    const fid = coerceOid(franchiseId);
    const removed = (removedServiceIds || []).map(coerceOid).filter(Boolean);
    if (!fid || removed.length === 0) {
        return { ok: true, skipped: true, reason: 'nothing_to_cascade' };
    }

    const ts = now();
    const partnerIds = await loadPartnerIdsForFranchise(fid);
    if (partnerIds.length === 0) {
        return { ok: true, franchiseId: fid.toString(), partnerRowsSkipped: true };
    }

    await softDeletePartnerServices({
        partner_id: { $in: partnerIds },
        service_id: { $in: removed },
    });

    await PartnerCategory.updateMany(
        { partner_id: { $in: partnerIds }, deleted_at: null, services: { $in: removed } },
        { $pullAll: { services: removed }, $set: { updated_at: ts } }
    );

    return {
        ok: true,
        franchiseId: fid.toString(),
        removedServices: removed.length,
        partnersAffected: partnerIds.length,
    };
};

/**
 * Partner category local is_active=false: soft-delete partner_service rows under that category.
 */
const onPartnerCategoriesDeactivated = async (partnerId, categoryIds) => {
    const pid = coerceOid(partnerId);
    const cats = (categoryIds || []).map(coerceOid).filter(Boolean);
    if (!pid || cats.length === 0) {
        return { ok: true, skipped: true };
    }

    await softDeletePartnerServices({
        partner_id: pid,
        category_id: { $in: cats },
    });

    return { ok: true, partnerId: pid.toString(), categories: cats.length };
};

/** @deprecated Alias — franchise category removal now handled in onFranchiseCategoriesRemoved. */
const cascadeInactiveCategoriesToFranchiseServices = async (franchiseOid, inactiveCategoryIds) => {
    return onFranchiseCategoriesRemoved(franchiseOid, inactiveCategoryIds);
};

module.exports = {
    isGlobalCatalogRowActive,
    validateGlobalServiceActivation,
    diffRemovedIds,
    onGlobalCategoryDeactivated,
    onGlobalServiceDeactivated,
    onFranchiseCategoriesRemoved,
    onFranchiseServicesRemoved,
    onPartnerCategoriesDeactivated,
    cascadeInactiveCategoriesToFranchiseServices,
};
