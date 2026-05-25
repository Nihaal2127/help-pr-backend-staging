const mongoose = require('mongoose');
const Category = require('../models/category');
const Service = require('../models/service');
const Franchise = require('../models/franchise');
const PartnerCategory = require('../models/partner_category');
const PartnerService = require('../models/partner_service');
const User = require('../models/user');
const {
    buildFranchiseEnabledMaps,
    GLOBAL_ACTIVE_CATEGORY_FILTER,
    GLOBAL_ACTIVE_SERVICE_FILTER,
    countGloballyActiveServices,
    pruneAndPersistFranchiseCatalogIds,
} = require('./franchise_catalog_from_franchise');

const toIdStr = (id) => (id ? id.toString() : '');

/**
 * Franchise/partner mapping entries store `is_active` in MongoDB.
 * Semantically this is local preference (`is_enabled`), NOT effective visibility.
 */
const isLocallyEnabled = (flag) => Boolean(flag);

const isGlobalCatalogRowActive = (doc) =>
    Boolean(doc && doc.deleted_at == null && doc.is_active === true && doc.is_request !== true);

/**
 * Category effective availability:
 * global.category.is_active && franchise.category.is_enabled && partner.category.is_enabled
 */
const computeCategoryEffectiveActive = ({
    globalActive,
    franchiseEnabled,
    partnerEnabled = true,
}) => Boolean(globalActive && franchiseEnabled && partnerEnabled);

/**
 * Service effective availability:
 * global.category.is_active && global.service.is_active &&
 * franchise.category.is_enabled && franchise.service.is_enabled &&
 * partner.category.is_enabled && partner.service.is_enabled
 */
const computeServiceEffectiveActive = ({
    globalCategoryActive,
    globalServiceActive,
    franchiseCategoryEnabled,
    franchiseServiceEnabled,
    partnerCategoryEnabled = true,
    partnerServiceEnabled = true,
}) =>
    Boolean(
        globalCategoryActive &&
            globalServiceActive &&
            franchiseCategoryEnabled &&
            franchiseServiceEnabled &&
            partnerCategoryEnabled &&
            partnerServiceEnabled
    );

/** Franchise.categories[] / services[] — membership in array means locally enabled. */
const buildFranchiseEnabledMapsFromFranchiseDoc = (franchise) => buildFranchiseEnabledMaps(franchise);

/**
 * Franchise catalog preferences from franchise.categories[] / services[] only.
 */
const resolveFranchiseMappingPreferenceMaps = async (franchiseId) => {
    const fid =
        franchiseId instanceof mongoose.Types.ObjectId
            ? franchiseId
            : mongoose.isValidObjectId(String(franchiseId))
              ? new mongoose.Types.ObjectId(String(franchiseId))
              : null;
    if (!fid) {
        return { ok: false, status: 400, message: 'Franchise must be a valid MongoDB ObjectId.' };
    }

    const franchise = await pruneAndPersistFranchiseCatalogIds(fid);
    if (!franchise) {
        return { ok: false, status: 404, message: 'Franchise not found.' };
    }

    return { ok: true, franchiseId: fid, ...buildFranchiseEnabledMapsFromFranchiseDoc(franchise) };
};

/** Alias — franchise arrays are the single source of truth. */
const resolveFranchiseAssignedEnabledMaps = resolveFranchiseMappingPreferenceMaps;

/** Alias: franchise catalog preferences (dashboard + all_* lists). */
const resolveFranchiseLocalEnabledMaps = resolveFranchiseMappingPreferenceMaps;

const loadGlobalCategoryActiveMap = async (categoryIds) => {
    const unique = [...new Set((categoryIds || []).map(toIdStr).filter(Boolean))];
    const map = new Map();
    if (unique.length === 0) return map;
    const rows = await Category.find({
        _id: { $in: unique },
        deleted_at: null,
        is_request: false,
    })
        .select('_id is_active')
        .lean();
    for (const row of rows) {
        map.set(row._id.toString(), isGlobalCatalogRowActive(row));
    }
    return map;
};

const loadGlobalServiceMetaMap = async (serviceIds) => {
    const unique = [...new Set((serviceIds || []).map(toIdStr).filter(Boolean))];
    const map = new Map();
    if (unique.length === 0) return map;
    const rows = await Service.find({
        _id: { $in: unique },
        deleted_at: null,
        is_request: false,
    })
        .select('_id is_active category_id')
        .lean();
    for (const row of rows) {
        map.set(row._id.toString(), {
            globalServiceActive: isGlobalCatalogRowActive(row),
            categoryId: row.category_id ? row.category_id.toString() : '',
        });
    }
    return map;
};

/**
 * Effective franchise catalog: global active ∩ franchise locally enabled ∩ assigned.
 */
const resolveFranchiseEffectiveCatalog = async (franchiseId) => {
    const local = await resolveFranchiseAssignedEnabledMaps(franchiseId);
    if (!local.ok) return local;

    const categoryIds = [...local.categoryEnabled.keys()].map(
        (s) => new mongoose.Types.ObjectId(s)
    );
    const serviceIds = [...local.serviceEnabled.keys()].map(
        (s) => new mongoose.Types.ObjectId(s)
    );

    const [globalCatActive, globalSvcMeta] = await Promise.all([
        loadGlobalCategoryActiveMap(categoryIds),
        loadGlobalServiceMetaMap(serviceIds),
    ]);

    const effectiveCategoryIds = [];
    for (const cid of categoryIds) {
        const key = cid.toString();
        const globalActive = globalCatActive.get(key) === true;
        const franchiseEnabled = local.categoryEnabled.get(key) === true;
        if (computeCategoryEffectiveActive({ globalActive, franchiseEnabled })) {
            effectiveCategoryIds.push(cid);
        }
    }

    const effectiveCategorySet = new Set(effectiveCategoryIds.map(toIdStr));
    const effectiveServiceIds = [];

    for (const sid of serviceIds) {
        const key = sid.toString();
        const meta = globalSvcMeta.get(key);
        if (!meta) continue;
        const franchiseServiceEnabled = local.serviceEnabled.get(key) === true;
        const franchiseCategoryEnabled =
            meta.categoryId && local.categoryEnabled.get(meta.categoryId) === true;
        const globalCategoryActive = meta.categoryId
            ? globalCatActive.get(meta.categoryId) === true
            : false;

        if (
            computeServiceEffectiveActive({
                globalCategoryActive,
                globalServiceActive: meta.globalServiceActive,
                franchiseCategoryEnabled,
                franchiseServiceEnabled,
            }) &&
            meta.categoryId &&
            effectiveCategorySet.has(meta.categoryId)
        ) {
            effectiveServiceIds.push(sid);
        }
    }

    return {
        ok: true,
        franchiseId: local.franchiseId,
        assignedCategoryIds: local.assignedCategoryIds,
        assignedServiceIds: local.assignedServiceIds,
        categoryEnabled: local.categoryEnabled,
        serviceEnabled: local.serviceEnabled,
        effectiveCategoryIds,
        effectiveServiceIds,
    };
};

const loadPartnerLocalEnabledMaps = async (partnerId) => {
    const pid =
        partnerId instanceof mongoose.Types.ObjectId
            ? partnerId
            : new mongoose.Types.ObjectId(String(partnerId));

    const [pcRows, psRows] = await Promise.all([
        PartnerCategory.find({ partner_id: pid, deleted_at: null }).select('category_id is_active').lean(),
        PartnerService.find({ partner_id: pid, deleted_at: null })
            .select('service_id category_id is_active')
            .lean(),
    ]);

    const categoryEnabled = new Map();
    for (const row of pcRows) {
        if (row.category_id) categoryEnabled.set(toIdStr(row.category_id), isLocallyEnabled(row.is_active));
    }

    const serviceEnabled = new Map();
    const serviceCategoryById = new Map();
    for (const row of psRows) {
        if (row.service_id) {
            serviceEnabled.set(toIdStr(row.service_id), isLocallyEnabled(row.is_active));
            if (row.category_id) serviceCategoryById.set(toIdStr(row.service_id), toIdStr(row.category_id));
        }
    }

    return { categoryEnabled, serviceEnabled, serviceCategoryById };
};

/**
 * Effective partner offerings: franchise effective ∩ partner locally enabled.
 */
const resolvePartnerEffectiveCatalog = async (partnerId) => {
    const user = await User.findOne({ _id: partnerId, deleted_at: null }).select('franchise_id').lean();
    if (!user) {
        return { ok: false, status: 401, message: 'User not found.' };
    }

    const partnerLocal = await loadPartnerLocalEnabledMaps(partnerId);
    const partnerCategoryIds = [...partnerLocal.categoryEnabled.keys()].map(
        (s) => new mongoose.Types.ObjectId(s)
    );
    const partnerServiceIds = [...partnerLocal.serviceEnabled.keys()].map(
        (s) => new mongoose.Types.ObjectId(s)
    );

    if (!user.franchise_id) {
        const [globalCatActive, globalSvcMeta] = await Promise.all([
            loadGlobalCategoryActiveMap(partnerCategoryIds),
            loadGlobalServiceMetaMap(partnerServiceIds),
        ]);

        const effectiveCategoryIds = partnerCategoryIds.filter((cid) => {
            const key = cid.toString();
            return computeCategoryEffectiveActive({
                globalActive: globalCatActive.get(key) === true,
                franchiseEnabled: true,
                partnerEnabled: partnerLocal.categoryEnabled.get(key) === true,
            });
        });
        const effectiveCategorySet = new Set(effectiveCategoryIds.map(toIdStr));
        const effectiveServiceIds = partnerServiceIds.filter((sid) => {
            const key = sid.toString();
            const meta = globalSvcMeta.get(key);
            if (!meta) return false;
            const catKey = meta.categoryId || partnerLocal.serviceCategoryById.get(key) || '';
            return computeServiceEffectiveActive({
                globalCategoryActive: globalCatActive.get(catKey) === true,
                globalServiceActive: meta.globalServiceActive,
                franchiseCategoryEnabled: true,
                franchiseServiceEnabled: true,
                partnerCategoryEnabled: partnerLocal.categoryEnabled.get(catKey) === true,
                partnerServiceEnabled: partnerLocal.serviceEnabled.get(key) === true,
            }) && effectiveCategorySet.has(catKey);
        });

        return {
            ok: true,
            hasFranchise: false,
            effectiveCategoryIds,
            effectiveServiceIds,
            partnerCategoryEnabled: partnerLocal.categoryEnabled,
            partnerServiceEnabled: partnerLocal.serviceEnabled,
        };
    }

    const franchiseEffective = await resolveFranchiseEffectiveCatalog(user.franchise_id);
    if (!franchiseEffective.ok) return franchiseEffective;

    const franchiseEffectiveCatSet = new Set(franchiseEffective.effectiveCategoryIds.map(toIdStr));
    const franchiseEffectiveSvcSet = new Set(franchiseEffective.effectiveServiceIds.map(toIdStr));

    const effectiveCategoryIds = partnerCategoryIds.filter((cid) => {
        const key = cid.toString();
        return (
            franchiseEffectiveCatSet.has(key) &&
            partnerLocal.categoryEnabled.get(key) === true
        );
    });

    const effectiveCategorySet = new Set(effectiveCategoryIds.map(toIdStr));
    const effectiveServiceIds = partnerServiceIds.filter((sid) => {
        const key = sid.toString();
        const categoryIdStr = partnerLocal.serviceCategoryById.get(key) || '';
        return (
            franchiseEffectiveSvcSet.has(key) &&
            categoryIdStr &&
            effectiveCategorySet.has(categoryIdStr) &&
            partnerLocal.serviceEnabled.get(key) === true &&
            partnerLocal.categoryEnabled.get(categoryIdStr) === true
        );
    });

    return {
        ok: true,
        hasFranchise: true,
        franchiseId: user.franchise_id,
        effectiveCategoryIds,
        effectiveServiceIds,
        partnerCategoryEnabled: partnerLocal.categoryEnabled,
        partnerServiceEnabled: partnerLocal.serviceEnabled,
        franchiseEffective,
    };
};

/** Backward-compatible: returns effectively available ids for partner franchise gate. */
const resolvePartnerFranchiseCatalog = async (partnerId) => {
    const user = await User.findOne({ _id: partnerId, deleted_at: null }).select('franchise_id');
    if (!user) {
        return { ok: false, status: 401, message: 'User not found.' };
    }
    if (!user.franchise_id) {
        return { ok: false, status: 400, message: 'Partner account is not linked to a franchise.' };
    }
    const resolved = await resolveFranchiseEffectiveCatalog(user.franchise_id);
    if (!resolved.ok) return resolved;
    return {
        ok: true,
        categoryIds: resolved.effectiveCategoryIds,
        serviceIds: resolved.effectiveServiceIds,
    };
};

/** Backward-compatible alias. */
const resolveFranchiseCatalogByFranchiseId = async (franchiseId) => {
    const resolved = await resolveFranchiseEffectiveCatalog(franchiseId);
    if (!resolved.ok) return resolved;
    return {
        ok: true,
        categoryIds: resolved.effectiveCategoryIds,
        serviceIds: resolved.effectiveServiceIds,
    };
};

/**
 * Dashboard counts for franchise scope (resolver-driven).
 */
const countFranchiseScopedAvailability = async (franchiseIdsScope, kind) => {
    if (!franchiseIdsScope || franchiseIdsScope.length === 0) {
        return {
            total_assigned: 0,
            locally_enabled: 0,
            globally_active: 0,
            effectively_available: 0,
        };
    }

    const CatalogModel = kind === 'category' ? Category : Service;
    const totalGlobal =
        kind === 'category'
            ? await CatalogModel.countDocuments(GLOBAL_ACTIVE_CATEGORY_FILTER)
            : await countGloballyActiveServices();

    let totalAssigned = 0;
    let locallyEnabled = 0;
    let globallyActive = 0;
    let effectivelyAvailable = 0;

    for (const franchiseOid of franchiseIdsScope) {
        const local = await resolveFranchiseMappingPreferenceMaps(franchiseOid);
        if (!local.ok) continue;

        const idMap = kind === 'category' ? local.categoryEnabled : local.serviceEnabled;
        const ids = [...idMap.keys()];
        totalAssigned += ids.length;

        if (ids.length === 0) continue;

        const oids = ids.map((s) => new mongoose.Types.ObjectId(s));
        if (kind === 'category') {
            const globalActive = await loadGlobalCategoryActiveMap(oids);
            for (const id of ids) {
                if (idMap.get(id) !== true) continue;
                const g = globalActive.get(id) === true;
                if (g) locallyEnabled += 1;
                if (g) globallyActive += 1;
                if (g && idMap.get(id) === true) effectivelyAvailable += 1;
            }
        } else {
            const effective = await resolveFranchiseEffectiveCatalog(franchiseOid);
            if (effective.ok) effectivelyAvailable += effective.effectiveServiceIds.length;
            const meta = await loadGlobalServiceMetaMap(oids);
            const catIds = [
                ...new Set(
                    [...meta.values()].map((m) => m.categoryId).filter(Boolean)
                ),
            ].map((s) => new mongoose.Types.ObjectId(s));
            const globalCatActive = await loadGlobalCategoryActiveMap(catIds);
            for (const id of ids) {
                const m = meta.get(id);
                if (!m) continue;
                if (idMap.get(id) !== true) continue;
                const gSvc = m.globalServiceActive;
                const gCat = m.categoryId ? globalCatActive.get(m.categoryId) === true : false;
                if (gSvc && gCat) {
                    locallyEnabled += 1;
                    globallyActive += 1;
                }
            }
        }
    }

    return {
        total_catalog: totalGlobal,
        total_assigned: totalAssigned,
        locally_enabled: locallyEnabled,
        globally_active: globallyActive,
        effectively_available: effectivelyAvailable,
        /** @deprecated use locally_enabled — kept for API compat */
        active: locallyEnabled,
        /** @deprecated */
        inactive: Math.max(0, totalGlobal - locallyEnabled),
        total: totalGlobal,
    };
};

const annotateCatalogRowWithAvailability = (row, opts) => {
    const globalActive = opts.globalActive === true;
    const franchiseEnabled = opts.franchiseEnabled === true;
    const partnerEnabled = opts.partnerEnabled !== false;
    const effectiveActive =
        opts.kind === 'category'
            ? computeCategoryEffectiveActive({ globalActive, franchiseEnabled, partnerEnabled })
            : computeServiceEffectiveActive({
                  globalCategoryActive: opts.globalCategoryActive === true,
                  globalServiceActive: globalActive,
                  franchiseCategoryEnabled: opts.franchiseCategoryEnabled === true,
                  franchiseServiceEnabled: franchiseEnabled,
                  partnerCategoryEnabled: opts.partnerCategoryEnabled !== false,
                  partnerServiceEnabled: partnerEnabled,
              });

    return {
        ...row,
        global_active: globalActive,
        franchise_enabled: franchiseEnabled,
        franchise_active: franchiseEnabled,
        partner_enabled: partnerEnabled,
        effective_active: effectiveActive,
    };
};

const extractRefId = (ref) => {
    if (!ref) return '';
    if (ref instanceof mongoose.Types.ObjectId) return ref.toString();
    if (typeof ref === 'object' && ref._id) return ref._id.toString();
    return String(ref);
};

/**
 * Franchise + partner local preference maps for annotating partner list APIs.
 * @param {mongoose.Types.ObjectId|string} partnerId
 */
const loadPartnerAvailabilityContext = async (partnerId) => {
    const user = await User.findOne({ _id: partnerId, deleted_at: null }).select('franchise_id').lean();
    if (!user) {
        return { ok: false, status: 401, message: 'User not found.' };
    }

    const partnerLocal = await loadPartnerLocalEnabledMaps(partnerId);
    let franchiseLocal = null;
    if (user.franchise_id) {
        franchiseLocal = await resolveFranchiseAssignedEnabledMaps(user.franchise_id);
        if (!franchiseLocal.ok) return franchiseLocal;
    }

    return {
        ok: true,
        franchiseId: user.franchise_id || null,
        partnerLocal,
        franchiseLocal: franchiseLocal && franchiseLocal.ok ? franchiseLocal : null,
    };
};

/**
 * Annotate a partner_category list row (API shape) with resolver fields.
 * `is_active` on the row remains partner local preference; use partner_enabled alias too.
 */
const enrichPartnerCategoryApiRecord = (record, ctx, globalCategoryDoc = null) => {
    const catKey = extractRefId(record.category_id);
    const globalActive = globalCategoryDoc
        ? isGlobalCatalogRowActive(globalCategoryDoc)
        : false;
    const partnerEnabled =
        record.is_active !== undefined
            ? isLocallyEnabled(record.is_active)
            : ctx.partnerLocal.categoryEnabled.get(catKey) === true;
    const franchiseEnabled = ctx.franchiseLocal
        ? ctx.franchiseLocal.categoryEnabled.get(catKey) === true
        : true;

    const availability = annotateCatalogRowWithAvailability(
        {
            global_active: globalActive,
            franchise_enabled: franchiseEnabled,
            partner_enabled: partnerEnabled,
            effective_active: computeCategoryEffectiveActive({
                globalActive,
                franchiseEnabled,
                partnerEnabled,
            }),
        },
        { kind: 'category', globalActive, franchiseEnabled, partnerEnabled }
    );

    return {
        ...record,
        ...availability,
        partner_enabled: partnerEnabled,
        /** Partner local preference (is_enabled); same value as is_active on stored row. */
        is_active: record.is_active,
    };
};

/**
 * Annotate a partner_service list row with resolver fields.
 */
const enrichPartnerServiceApiRecord = (
    record,
    ctx,
    globalServiceDoc = null,
    globalCategoryDoc = null
) => {
    const svcKey = extractRefId(record.service_id);
    const catKey =
        extractRefId(record.category_id) ||
        (globalServiceDoc && globalServiceDoc.category_id
            ? extractRefId(globalServiceDoc.category_id)
            : ctx.partnerLocal.serviceCategoryById.get(svcKey) || '');

    const globalServiceActive = globalServiceDoc
        ? isGlobalCatalogRowActive(globalServiceDoc)
        : false;
    const globalCategoryActive = globalCategoryDoc
        ? isGlobalCatalogRowActive(globalCategoryDoc)
        : false;

    const partnerServiceEnabled =
        record.is_active !== undefined
            ? isLocallyEnabled(record.is_active)
            : ctx.partnerLocal.serviceEnabled.get(svcKey) === true;
    const partnerCategoryEnabled = catKey
        ? ctx.partnerLocal.categoryEnabled.get(catKey) === true
        : true;

    const franchiseServiceEnabled = ctx.franchiseLocal
        ? ctx.franchiseLocal.serviceEnabled.get(svcKey) === true
        : true;
    const franchiseCategoryEnabled = ctx.franchiseLocal
        ? ctx.franchiseLocal.categoryEnabled.get(catKey) === true
        : true;

    const availability = annotateCatalogRowWithAvailability(
        {},
        {
            kind: 'service',
            globalActive: globalServiceActive,
            globalCategoryActive,
            franchiseEnabled: franchiseServiceEnabled,
            franchiseCategoryEnabled,
            partnerEnabled: partnerServiceEnabled,
            partnerCategoryEnabled,
        }
    );

    return {
        ...record,
        ...availability,
        partner_enabled: partnerServiceEnabled,
        is_active: record.is_active,
    };
};

/**
 * Annotate franchise_category mapping entries (categories_list items).
 */
const enrichFranchiseCategoryMappingEntries = async (entries, franchiseOid) => {
    if (!entries || entries.length === 0) return entries;
    const local = await resolveFranchiseMappingPreferenceMaps(franchiseOid);
    const franchiseEnabledMap = local.ok ? local.categoryEnabled : new Map();

    return entries.map((e) => {
        const catDoc =
            e.category_id && typeof e.category_id === 'object' && !(e.category_id instanceof mongoose.Types.ObjectId)
                ? e.category_id
                : null;
        const globalActive = isGlobalCatalogRowActive(catDoc);
        const franchiseEnabled = isLocallyEnabled(e.is_active);
        return annotateCatalogRowWithAvailability(
            { ...e, franchise_enabled: franchiseEnabled },
            { kind: 'category', globalActive, franchiseEnabled, partnerEnabled: true }
        );
    });
};

/**
 * Annotate franchise_service mapping entries (services_list items).
 */
const enrichFranchiseServiceMappingEntries = async (entries, franchiseOid) => {
    if (!entries || entries.length === 0) return entries;
    const local = await resolveFranchiseMappingPreferenceMaps(franchiseOid);
    const franchiseCategoryEnabled = local.ok ? local.categoryEnabled : new Map();
    const franchiseServiceEnabled = local.ok ? local.serviceEnabled : new Map();

    const catIds = [];
    for (const e of entries) {
        const svc =
            e.service_id && typeof e.service_id === 'object' && !(e.service_id instanceof mongoose.Types.ObjectId)
                ? e.service_id
                : null;
        const cid = svc && svc.category_id ? extractRefId(svc.category_id) : '';
        if (cid) catIds.push(new mongoose.Types.ObjectId(cid));
    }
    const globalCatActive = await loadGlobalCategoryActiveMap(catIds);

    return entries.map((e) => {
        const svcDoc =
            e.service_id && typeof e.service_id === 'object' && !(e.service_id instanceof mongoose.Types.ObjectId)
                ? e.service_id
                : null;
        const catKey = svcDoc && svcDoc.category_id ? extractRefId(svcDoc.category_id) : '';
        const globalServiceActive = isGlobalCatalogRowActive(svcDoc);
        const globalCategoryActive = catKey ? globalCatActive.get(catKey) === true : false;
        const franchiseServiceOnList = isLocallyEnabled(e.is_active);
        const franchiseCategoryOnFranchise = catKey
            ? franchiseCategoryEnabled.get(catKey) === true
            : false;
        const franchiseEnabledFlag = franchiseServiceOnList && franchiseCategoryOnFranchise;

        return annotateCatalogRowWithAvailability(
            { ...e, franchise_enabled: franchiseEnabledFlag },
            {
                kind: 'service',
                globalActive: globalServiceActive,
                globalCategoryActive,
                franchiseEnabled: franchiseEnabledFlag,
                franchiseCategoryEnabled: franchiseCategoryOnFranchise,
                partnerEnabled: true,
            }
        );
    });
};

/**
 * Full franchise_category mapping documents for list/getById APIs.
 */
const enrichFranchiseCategoryMappingRecords = async (records) => {
    if (!Array.isArray(records) || records.length === 0) return records;
    const out = [];
    for (const row of records) {
        const plain = row && typeof row.toObject === 'function' ? row.toObject() : { ...row };
        const fid = plain.franchise_id;
        const franchiseOid =
            fid instanceof mongoose.Types.ObjectId
                ? fid
                : fid && fid._id
                  ? fid._id
                  : fid
                    ? new mongoose.Types.ObjectId(String(fid))
                    : null;
        if (franchiseOid && Array.isArray(plain.categories_list)) {
            plain.categories_list = await enrichFranchiseCategoryMappingEntries(
                plain.categories_list,
                franchiseOid
            );
        }
        out.push(plain);
    }
    return out;
};

/**
 * Full franchise_service mapping documents for list/getById APIs.
 */
const enrichFranchiseServiceMappingRecords = async (records) => {
    if (!Array.isArray(records) || records.length === 0) return records;
    const out = [];
    for (const row of records) {
        const plain = row && typeof row.toObject === 'function' ? row.toObject() : { ...row };
        const fid = plain.franchise_id;
        const franchiseOid =
            fid instanceof mongoose.Types.ObjectId
                ? fid
                : fid && fid._id
                  ? fid._id
                  : fid
                    ? new mongoose.Types.ObjectId(String(fid))
                    : null;
        if (franchiseOid && Array.isArray(plain.services_list)) {
            plain.services_list = await enrichFranchiseServiceMappingEntries(
                plain.services_list,
                franchiseOid
            );
        }
        out.push(plain);
    }
    return out;
};

module.exports = {
    isLocallyEnabled,
    isGlobalCatalogRowActive,
    computeCategoryEffectiveActive,
    computeServiceEffectiveActive,
    resolveFranchiseMappingPreferenceMaps,
    resolveFranchiseAssignedEnabledMaps,
    resolveFranchiseLocalEnabledMaps,
    resolveFranchiseEffectiveCatalog,
    resolveFranchiseCatalogByFranchiseId,
    resolvePartnerFranchiseCatalog,
    resolvePartnerEffectiveCatalog,
    loadPartnerLocalEnabledMaps,
    loadPartnerAvailabilityContext,
    enrichPartnerCategoryApiRecord,
    enrichPartnerServiceApiRecord,
    enrichFranchiseCategoryMappingEntries,
    enrichFranchiseServiceMappingEntries,
    enrichFranchiseCategoryMappingRecords,
    enrichFranchiseServiceMappingRecords,
    countFranchiseScopedAvailability,
    annotateCatalogRowWithAvailability,
    loadGlobalCategoryActiveMap,
    loadGlobalServiceMetaMap,
};
