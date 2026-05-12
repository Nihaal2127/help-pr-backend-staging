const mongoose = require('mongoose');

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
        return { ok: false, message: `${fieldName} must be a valid MongoDB ObjectId.` };
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
        return { ok: false, message: `${fieldName} must be an array.` };
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
        return { ok: false, message: `${fieldName} must be an array.` };
    }
    const oids = [];
    for (let i = 0; i < raw.length; i += 1) {
        const p = parseObjectId(raw[i], `${fieldName}[${i}]`);
        if (!p.ok) return p;
        oids.push(p.oid);
    }
    return { ok: true, oids };
};

/** Legacy plain ObjectId entries or { category_id, is_active }. */
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

/**
 * Legacy DB rows stored active_categories / inactive_categories as booleans.
 * Response shape always uses ObjectId[] for those fields.
 */
const coerceLegacyCategoryMappingArrays = (plain) => {
    if (!plain || typeof plain !== 'object') return plain;
    const out = typeof plain.toObject === 'function' ? plain.toObject() : { ...plain };
    const ac = out.active_categories;
    const ic = out.inactive_categories;
    if (typeof ac === 'boolean' || typeof ic === 'boolean') {
        const norm = normalizeStoredCategoriesList(out.categories_list);
        out.active_categories = norm.filter((e) => e.is_active).map((e) => e.category_id);
        out.inactive_categories = norm.filter((e) => !e.is_active).map((e) => e.category_id);
    }
    if (!Array.isArray(out.active_categories)) out.active_categories = [];
    if (!Array.isArray(out.inactive_categories)) out.inactive_categories = [];
    if (!Array.isArray(out.categories_order)) {
        const norm = normalizeStoredCategoriesList(out.categories_list || []);
        out.categories_order = norm.map((e) => e.category_id);
    }
    /** Response-only: reflect toggle state from active_categories without persisting to categories_list. */
    const activeSet = new Set((out.active_categories || []).map((id) => id.toString()));
    const normList = normalizeStoredCategoriesList(out.categories_list || []);
    out.categories_list = normList.map((e) => ({
        category_id: e.category_id,
        is_active: activeSet.has(e.category_id.toString()),
    }));
    return out;
};

const coerceLegacyServiceMappingArrays = (plain) => {
    if (!plain || typeof plain !== 'object') return plain;
    const out = typeof plain.toObject === 'function' ? plain.toObject() : { ...plain };
    const ac = out.active_services;
    const ic = out.inactive_services;
    if (typeof ac === 'boolean' || typeof ic === 'boolean') {
        const norm = normalizeStoredServicesList(out.services_list);
        out.active_services = norm.filter((e) => e.is_active).map((e) => e.service_id);
        out.inactive_services = norm.filter((e) => !e.is_active).map((e) => e.service_id);
    }
    if (!Array.isArray(out.active_services)) out.active_services = [];
    if (!Array.isArray(out.inactive_services)) out.inactive_services = [];
    if (!Array.isArray(out.services_order)) {
        const norm = normalizeStoredServicesList(out.services_list || []);
        out.services_order = norm.map((e) => e.service_id);
    }
    const activeSet = new Set((out.active_services || []).map((id) => id.toString()));
    const normList = normalizeStoredServicesList(out.services_list || []);
    out.services_list = normList.map((e) => ({
        service_id: e.service_id,
        is_active: activeSet.has(e.service_id.toString()),
    }));
    return out;
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
            return { ok: false, message: 'active_categories and inactive_categories must not overlap.' };
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
            return { ok: false, message: 'active_categories contains a category_id not in categories_list.' };
        }
    }
    for (const s of inactiveStr) {
        if (!catalogStr.has(s)) {
            return { ok: false, message: 'inactive_categories contains a category_id not in categories_list.' };
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
            return { ok: false, message: 'active_services and inactive_services must not overlap.' };
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
            return { ok: false, message: 'active_services contains a service_id not in services_list.' };
        }
    }
    for (const s of inactiveStr) {
        if (!catalogStr.has(s)) {
            return { ok: false, message: 'inactive_services contains a service_id not in services_list.' };
        }
    }
    for (const s of catalogStr) {
        if (!activeStr.has(s) && !inactiveStr.has(s)) {
            return {
                ok: false,
                message: 'Each service in services_list must appear in active_services or inactive_services.',
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
            message: 'categories_order must be empty when categories_list has no categories.',
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
            return { ok: false, message: 'categories_order contains duplicate category ids.' };
        }
        seen.add(s);
        if (!catalogStr.has(s)) {
            return {
                ok: false,
                message: 'categories_order contains a category_id that is not in categories_list.',
            };
        }
    }
    for (const c of catalogStr) {
        if (!seen.has(c)) {
            return {
                ok: false,
                message: 'categories_order must include every category_id from categories_list.',
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
            message: 'services_order must be empty when services_list has no services.',
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
            return { ok: false, message: 'services_order contains duplicate service ids.' };
        }
        seen.add(s);
        if (!catalogStr.has(s)) {
            return {
                ok: false,
                message: 'services_order contains a service_id that is not in services_list.',
            };
        }
    }
    for (const c of catalogStr) {
        if (!seen.has(c)) {
            return {
                ok: false,
                message: 'services_order must include every service_id from services_list.',
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
 * Keep only franchise-toggle active or inactive rows (after coerceLegacy* sets entry.is_active).
 * Optionally updates:
 * - active_*
 * - inactive_*
 * - *_order
 * fields to stay consistent with the filtered list.
 *
 * @param {unknown[]} records
 * @param {boolean | undefined} mappingActiveFilter — true = franchise-on only, false = franchise-off only
 * @param {'categories_list'|'services_list'} listKey
 * @param {'active_categories'|'active_services'} activeKey
 * @param {'inactive_categories'|'inactive_services'} inactiveKey
 * @param {'category_id'|'service_id'} entryIdKey
 */
const filterRecordsByFranchiseMappingToggle = (
    records,
    mappingActiveFilter,
    listKey,
    activeKey,
    inactiveKey,
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
        if (mappingActiveFilter === true) {
            plain[activeKey] = ids;
            plain[inactiveKey] = [];
        } else {
            plain[activeKey] = [];
            plain[inactiveKey] = ids;
        }
        const idSet = new Set(ids.map((id) => id.toString()));
        if (Array.isArray(plain[orderKey])) {
            plain[orderKey] = plain[orderKey].filter((oid) => idSet.has(oid.toString()));
        }
        return plain;
    });
};

module.exports = {
    dedupeObjectIdsPreserveOrder,
    parseObjectIdArray,
    parseObjectIdArrayOrdered,
    normalizeStoredCategoriesList,
    normalizeStoredServicesList,
    coerceLegacyCategoryMappingArrays,
    coerceLegacyServiceMappingArrays,
    validateCategoryActiveInactivePartition,
    validateServiceActiveInactivePartition,
    validateCategoriesOrderPermutation,
    validateServicesOrderPermutation,
    filterRecordsByFranchiseMappingToggle,
};
