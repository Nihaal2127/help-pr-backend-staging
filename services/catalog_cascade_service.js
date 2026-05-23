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
 * Category/service ids removed from a franchise enablement array (before → after).
 */
const diffRemovedIds = (beforeIds, afterIds) => {
    const afterSet = new Set((afterIds || []).map(toIdStr).filter(Boolean));
    return (beforeIds || []).filter((id) => {
        const key = toIdStr(id);
        return key && !afterSet.has(key);
    });
};

const loadServiceIdsForCategories = async (categoryIds) => {
    const oids = (categoryIds || []).map(coerceOid).filter(Boolean);
    if (oids.length === 0) return [];
    const rows = await Service.find({
        category_id: { $in: oids },
        deleted_at: null,
    })
        .select('_id')
        .lean();
    return rows.map((r) => r._id);
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
    if (serviceIds.length > 0) {
        await Franchise.updateMany(
            { deleted_at: null },
            { $pullAll: { services: serviceIds }, $set: { updated_at: ts } }
        );
    }

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
    };
};

/**
 * Global service deactivated or soft-deleted: prune franchise arrays, soft-delete partner rows.
 */
const onGlobalServiceDeactivated = async (serviceId) => {
    const svcOid = coerceOid(serviceId);
    if (!svcOid) return { ok: false, reason: 'invalid_service_id' };

    const ts = now();
    await Franchise.updateMany(
        { deleted_at: null },
        { $pull: { services: svcOid }, $set: { updated_at: ts } }
    );

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

    const ts = now();
    const serviceIds = await loadServiceIdsForCategories(removed);
    const partnerIds = await loadPartnerIdsForFranchise(fid);

    if (serviceIds.length > 0) {
        await Franchise.updateOne(
            { _id: fid, deleted_at: null },
            { $pullAll: { services: serviceIds }, $set: { updated_at: ts } }
        );
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
    diffRemovedIds,
    onGlobalCategoryDeactivated,
    onGlobalServiceDeactivated,
    onFranchiseCategoriesRemoved,
    onFranchiseServicesRemoved,
    onPartnerCategoriesDeactivated,
    cascadeInactiveCategoriesToFranchiseServices,
};
