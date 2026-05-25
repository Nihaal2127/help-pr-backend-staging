const mongoose = require('mongoose');
const { fieldLabel } = require('./field_labels');

/** @param {mongoose.Types.ObjectId[]} oids */
const dedupeObjectIdsPreserveOrder = (oids) => {
    const seen = new Set();
    const out = [];
    for (const oid of oids || []) {
        if (!oid) continue;
        const s = oid.toString();
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(oid);
    }
    return out;
};

const parseObjectId = (raw, fieldName) => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const value = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!value || !/^[a-fA-F0-9]{24}$/.test(value)) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be a valid MongoDB ObjectId.` };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(value) };
};

/**
 * @param {unknown} raw
 * @param {string} fieldName
 * @returns {{ ok: true, oids: mongoose.Types.ObjectId[] } | { ok: false, message: string }}
 */
const parseObjectIdArray = (raw, fieldName) => {
    if (!Array.isArray(raw)) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be an array.` };
    }
    const oids = [];
    for (let i = 0; i < raw.length; i += 1) {
        const p = parseObjectId(raw[i], `${fieldName}[${i}]`);
        if (!p.ok) return p;
        oids.push(p.oid);
    }
    return { ok: true, oids: dedupeObjectIdsPreserveOrder(oids) };
};

/**
 * Same as parseObjectIdArray but preserves duplicates until validation fails (used for ordered id lists).
 * @returns {{ ok: true, oids: mongoose.Types.ObjectId[] } | { ok: false, message: string }}
 */
const parseObjectIdArrayOrdered = (raw, fieldName) => {
    if (!Array.isArray(raw)) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be an array.` };
    }
    const oids = [];
    for (let i = 0; i < raw.length; i += 1) {
        const p = parseObjectId(raw[i], `${fieldName}[${i}]`);
        if (!p.ok) return p;
        oids.push(p.oid);
    }
    return { ok: true, oids };
};

/**
 * Franchise/partner mapping list entries.
 * DB field `is_active` = local preference (conceptually `is_enabled`), NOT effective visibility.
 */
const normalizeStoredCategoriesList = (raw) => {
    if (!raw || !Array.isArray(raw) || raw.length === 0) return [];
    const out = [];
    for (const item of raw) {
        if (!item) continue;
        if (typeof item === 'object' && item.category_id) {
            out.push({
                category_id: item.category_id,
                is_active: Boolean(item.is_active),
            });
        } else if (item instanceof mongoose.Types.ObjectId) {
            out.push({ category_id: item, is_active: true });
        }
    }
    return out;
};

const normalizeStoredServicesList = (raw) => {
    if (!raw || !Array.isArray(raw) || raw.length === 0) return [];
    const out = [];
    for (const item of raw) {
        if (!item) continue;
        if (typeof item === 'object' && item.service_id) {
            out.push({
                service_id: item.service_id,
                is_active: Boolean(item.is_active),
            });
        } else if (item instanceof mongoose.Types.ObjectId) {
            out.push({ service_id: item, is_active: true });
        }
    }
    return out;
};

/** Build legacy partition arrays from categories_list (response-only; not source of truth). */
const deriveCategoryPartitionFromList = (normList) => ({
    active_categories: normList.filter((e) => e.is_active).map((e) => e.category_id),
    inactive_categories: normList.filter((e) => !e.is_active).map((e) => e.category_id),
});

/** Build legacy partition arrays from services_list (response-only; not source of truth). */
const deriveServicePartitionFromList = (normList) => ({
    active_services: normList.filter((e) => e.is_active).map((e) => e.service_id),
    inactive_services: normList.filter((e) => !e.is_active).map((e) => e.service_id),
});

/**
 * Legacy rows may only have active_categories / inactive_categories arrays.
 * Rebuild categories_list once for reads.
 */
const rebuildCategoriesListFromLegacyPartition = (activeIds, inactiveIds) => {
    const out = [];
    for (const id of activeIds || []) {
        out.push({ category_id: id, is_active: true });
    }
    for (const id of inactiveIds || []) {
        out.push({ category_id: id, is_active: false });
    }
    return out;
};

const rebuildServicesListFromLegacyPartition = (activeIds, inactiveIds) => {
    const out = [];
    for (const id of activeIds || []) {
        out.push({ service_id: id, is_active: true });
    }
    for (const id of inactiveIds || []) {
        out.push({ service_id: id, is_active: false });
    }
    return out;
};

/**
 * Coerce franchise_category mapping for API responses.
 * Source of truth: categories_list[].is_active (local is_enabled preference).
 * active_categories / inactive_categories are derived for backward compatibility only.
 */
const coerceLegacyCategoryMappingArrays = (plain) => {
    if (!plain || typeof plain !== 'object') return plain;
    const out = typeof plain.toObject === 'function' ? plain.toObject() : { ...plain };

    let normList = normalizeStoredCategoriesList(out.categories_list || []);

    const acLegacy = Array.isArray(out.active_categories) ? out.active_categories : [];
    const icLegacy = Array.isArray(out.inactive_categories) ? out.inactive_categories : [];
    const hasLegacyBoolean =
        typeof out.active_categories === 'boolean' || typeof out.inactive_categories === 'boolean';

    if (normList.length === 0 && (acLegacy.length > 0 || icLegacy.length > 0 || hasLegacyBoolean)) {
        if (hasLegacyBoolean) {
            normList = normalizeStoredCategoriesList(out.categories_list || []);
        } else {
            normList = rebuildCategoriesListFromLegacyPartition(acLegacy, icLegacy);
        }
    }

    out.categories_list = normList;

    const derived = deriveCategoryPartitionFromList(normList);
    out.active_categories = derived.active_categories;
    out.inactive_categories = derived.inactive_categories;

    if (!Array.isArray(out.categories_order) || out.categories_order.length === 0) {
        out.categories_order = normList.map((e) => e.category_id);
    }

    return out;
};

/**
 * Coerce franchise_service mapping for API responses.
 * Source of truth: services_list[].is_active (local is_enabled preference).
 */
const coerceLegacyServiceMappingArrays = (plain) => {
    if (!plain || typeof plain !== 'object') return plain;
    const out = typeof plain.toObject === 'function' ? plain.toObject() : { ...plain };

    let normList = normalizeStoredServicesList(out.services_list || []);

    const acLegacy = Array.isArray(out.active_services) ? out.active_services : [];
    const icLegacy = Array.isArray(out.inactive_services) ? out.inactive_services : [];
    const hasLegacyBoolean =
        typeof out.active_services === 'boolean' || typeof out.inactive_services === 'boolean';

    if (normList.length === 0 && (acLegacy.length > 0 || icLegacy.length > 0 || hasLegacyBoolean)) {
        if (hasLegacyBoolean) {
            normList = normalizeStoredServicesList(out.services_list || []);
        } else {
            normList = rebuildServicesListFromLegacyPartition(acLegacy, icLegacy);
        }
    }

    out.services_list = normList;

    const derived = deriveServicePartitionFromList(normList);
    out.active_services = derived.active_services;
    out.inactive_services = derived.inactive_services;

    if (!Array.isArray(out.services_order) || out.services_order.length === 0) {
        out.services_order = normList.map((e) => e.service_id);
    }

    return out;
};

/**
 * Apply active/inactive partition API input to categories_list (local preference only).
 */
const applyCategoryPartitionToCategoriesList = (normList, activeIds, inactiveIds) => {
    const activeSet = new Set((activeIds || []).map((id) => id.toString()));
    const inactiveSet = new Set((inactiveIds || []).map((id) => id.toString()));
    return normList.map((e) => {
        const key = e.category_id.toString();
        let enabled = e.is_active;
        if (activeSet.has(key)) enabled = true;
        else if (inactiveSet.has(key)) enabled = false;
        return { category_id: e.category_id, is_active: enabled };
    });
};

const applyServicePartitionToServicesList = (normList, activeIds, inactiveIds) => {
    const activeSet = new Set((activeIds || []).map((id) => id.toString()));
    const inactiveSet = new Set((inactiveIds || []).map((id) => id.toString()));
    return normList.map((e) => {
        const key = e.service_id.toString();
        let enabled = e.is_active;
        if (activeSet.has(key)) enabled = true;
        else if (inactiveSet.has(key)) enabled = false;
        return { service_id: e.service_id, is_active: enabled };
    });
};

/**
 * @param {Set<string>} catalogStr
 * @param {mongoose.Types.ObjectId[]} activeIds
 * @param {mongoose.Types.ObjectId[]} inactiveIds
 */
const validateCategoryActiveInactivePartition = (catalogStr, activeIds, inactiveIds) => {
    const activeStr = new Set((activeIds || []).map((id) => id.toString()));
    const inactiveStr = new Set((inactiveIds || []).map((id) => id.toString()));
    for (const s of activeStr) {
        if (inactiveStr.has(s)) {
            return { ok: false, message: 'Active categories and inactive categories must not overlap.' };
        }
    }
    if (activeStr.size + inactiveStr.size !== catalogStr.size) {
        return {
            ok: false,
            message:
                'active_categories and inactive_categories must partition categories_list (every mapped category appears exactly once).',
        };
    }
    for (const s of activeStr) {
        if (!catalogStr.has(s)) {
            return { ok: false, message: 'Active categories contains a category not in the categories list.' };
        }
    }
    for (const s of inactiveStr) {
        if (!catalogStr.has(s)) {
            return { ok: false, message: 'Inactive categories contains a category not in the categories list.' };
        }
    }
    for (const s of catalogStr) {
        if (!activeStr.has(s) && !inactiveStr.has(s)) {
            return {
                ok: false,
                message:
                    'Each category in categories_list must appear in active_categories or inactive_categories.',
            };
        }
    }
    return { ok: true };
};

const validateServiceActiveInactivePartition = (catalogStr, activeIds, inactiveIds) => {
    const activeStr = new Set((activeIds || []).map((id) => id.toString()));
    const inactiveStr = new Set((inactiveIds || []).map((id) => id.toString()));
    for (const s of activeStr) {
        if (inactiveStr.has(s)) {
            return { ok: false, message: 'Active services and inactive services must not overlap.' };
        }
    }
    if (activeStr.size + inactiveStr.size !== catalogStr.size) {
        return {
            ok: false,
            message:
                'active_services and inactive_services must partition services_list (every mapped service appears exactly once).',
        };
    }
    for (const s of activeStr) {
        if (!catalogStr.has(s)) {
            return { ok: false, message: 'Active services contains a service not in the services list.' };
        }
    }
    for (const s of inactiveStr) {
        if (!catalogStr.has(s)) {
            return { ok: false, message: 'Inactive services contains a service not in the services list.' };
        }
    }
    for (const s of catalogStr) {
        if (!activeStr.has(s) && !inactiveStr.has(s)) {
            return {
                ok: false,
                message: 'Each service in the services list must appear in active or inactive services.',
            };
        }
    }
    return { ok: true };
};

/**
 * @param {mongoose.Types.ObjectId[]} orderOids
 * @param {Set<string>} catalogStr — category_id strings in categories_list
 */
const validateCategoriesOrderPermutation = (orderOids, catalogStr) => {
    if (catalogStr.size === 0) {
        if (!orderOids || orderOids.length === 0) return { ok: true };
        return {
            ok: false,
            message: 'Categories order must be empty when the categories list has no categories.',
        };
    }
    if (!orderOids || orderOids.length !== catalogStr.size) {
        return {
            ok: false,
            message:
                'categories_order must list every category_id in categories_list exactly once, in display order.',
        };
    }
    const seen = new Set();
    for (const oid of orderOids) {
        const s = oid.toString();
        if (seen.has(s)) {
            return { ok: false, message: 'Categories order contains duplicate category ids.' };
        }
        seen.add(s);
        if (!catalogStr.has(s)) {
            return {
                ok: false,
                message: 'Categories order contains a category that is not in the categories list.',
            };
        }
    }
    for (const c of catalogStr) {
        if (!seen.has(c)) {
            return {
                ok: false,
                message: 'Categories order must include every category from the categories list.',
            };
        }
    }
    return { ok: true };
};

/**
 * @param {mongoose.Types.ObjectId[]} orderOids
 * @param {Set<string>} catalogStr — service_id strings in services_list
 */
const validateServicesOrderPermutation = (orderOids, catalogStr) => {
    if (catalogStr.size === 0) {
        if (!orderOids || orderOids.length === 0) return { ok: true };
        return {
            ok: false,
            message: 'Services order must be empty when the services list has no services.',
        };
    }
    if (!orderOids || orderOids.length !== catalogStr.size) {
        return {
            ok: false,
            message:
                'services_order must list every service_id in services_list exactly once, in display order.',
        };
    }
    const seen = new Set();
    for (const oid of orderOids) {
        const s = oid.toString();
        if (seen.has(s)) {
            return { ok: false, message: 'Services order contains duplicate service ids.' };
        }
        seen.add(s);
        if (!catalogStr.has(s)) {
            return {
                ok: false,
                message: 'Services order contains a service that is not in the services list.',
            };
        }
    }
    for (const c of catalogStr) {
        if (!seen.has(c)) {
            return {
                ok: false,
                message: 'Services order must include every service from the services list.',
            };
        }
    }
    return { ok: true };
};

/** Populated ref or raw ObjectId from a categories_list / services_list entry. */
const extractCatalogRefId = (ref) => {
    if (!ref) return null;
    if (ref instanceof mongoose.Types.ObjectId) return ref;
    if (typeof ref === 'object' && ref._id) return ref._id;
    return ref;
};

/**
 * Filter mapping records by local franchise preference (categories_list / services_list is_active).
 */
const filterRecordsByFranchiseMappingToggle = (
    records,
    mappingActiveFilter,
    listKey,
    _activeKey,
    _inactiveKey,
    entryIdKey
) => {
    if (mappingActiveFilter === undefined) return records;
    const orderKey = listKey === 'categories_list' ? 'categories_order' : 'services_order';
    return records.map((row) => {
        const plain = row && typeof row.toObject === 'function' ? row.toObject() : { ...row };
        const list = Array.isArray(plain[listKey]) ? plain[listKey] : [];
        const filtered = list.filter((e) => Boolean(e.is_active) === mappingActiveFilter);
        plain[listKey] = filtered;
        const ids = filtered.map((e) => extractCatalogRefId(e[entryIdKey])).filter(Boolean);
        if (listKey === 'categories_list') {
            const derived = deriveCategoryPartitionFromList(
                filtered.map((e) => ({
                    category_id: extractCatalogRefId(e.category_id),
                    is_active: e.is_active,
                }))
            );
            plain.active_categories = derived.active_categories;
            plain.inactive_categories = derived.inactive_categories;
        } else {
            const derived = deriveServicePartitionFromList(
                filtered.map((e) => ({
                    service_id: extractCatalogRefId(e.service_id),
                    is_active: e.is_active,
                }))
            );
            plain.active_services = derived.active_services;
            plain.inactive_services = derived.inactive_services;
        }
        const idSet = new Set(ids.map((id) => id.toString()));
        if (Array.isArray(plain[orderKey])) {
            plain[orderKey] = plain[orderKey].filter((oid) => idSet.has(oid.toString()));
        }
        return plain;
    });
};

/** Strip derived partition arrays before persisting (lists are the only stored preference). */
const stripDerivedPartitionArraysFromCategoryMapping = (record) => {
    if (!record) return record;
    record.active_categories = undefined;
    record.inactive_categories = undefined;
    return record;
};

const stripDerivedPartitionArraysFromServiceMapping = (record) => {
    if (!record) return record;
    record.active_services = undefined;
    record.inactive_services = undefined;
    return record;
};

module.exports = {
    parseObjectId,
    dedupeObjectIdsPreserveOrder,
    parseObjectIdArray,
    parseObjectIdArrayOrdered,
    normalizeStoredCategoriesList,
    normalizeStoredServicesList,
    deriveCategoryPartitionFromList,
    deriveServicePartitionFromList,
    applyCategoryPartitionToCategoriesList,
    applyServicePartitionToServicesList,
    coerceLegacyCategoryMappingArrays,
    coerceLegacyServiceMappingArrays,
    validateCategoryActiveInactivePartition,
    validateServiceActiveInactivePartition,
    validateCategoriesOrderPermutation,
    validateServicesOrderPermutation,
    filterRecordsByFranchiseMappingToggle,
    stripDerivedPartitionArraysFromCategoryMapping,
    stripDerivedPartitionArraysFromServiceMapping,
};
