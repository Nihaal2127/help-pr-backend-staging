const mongoose = require('mongoose');
const FranchiseCategory = require('../models/franchise_category');
const Franchise = require('../models/franchise');
const Category = require('../models/category');
const User = require('../models/user');
const { applyPagination } = require('../utils/pagination');

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const USER_TYPE_ADMIN = 1;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

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

/** Normalize DB value: legacy plain ObjectId entries or { category_id, is_active }. */
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

const parseCategoriesListInput = (raw, fieldName) => {
    if (!Array.isArray(raw)) return { ok: false, message: `${fieldName} must be an array.` };
    const entries = [];
    const seen = new Set();
    for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        const isObjectShape =
            item !== null &&
            typeof item === 'object' &&
            !(item instanceof mongoose.Types.ObjectId) &&
            item.category_id !== undefined &&
            item.category_id !== null;

        if (isObjectShape) {
            const p = parseObjectId(item.category_id, `${fieldName}[${i}].category_id`);
            if (!p.ok) return p;
            const key = p.oid.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ category_id: p.oid, is_active: Boolean(item.is_active) });
        } else {
            const p = parseObjectId(item, `${fieldName}[${i}]`);
            if (!p.ok) return p;
            const key = p.oid.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ category_id: p.oid, is_active: true });
        }
    }
    return { ok: true, entries };
};

const parseOptionalQueryBool = (raw, fieldName) => {
    if (raw === undefined || raw === null) return { ok: true, present: false };
    const s = String(raw).trim().toLowerCase();
    if (s === '') return { ok: true, present: false };
    if (s === 'true' || s === '1') return { ok: true, present: true, value: true };
    if (s === 'false' || s === '0') return { ok: true, present: true, value: false };
    return { ok: false, message: `${fieldName} must be true or false.` };
};

const categoryEntryMatchesCatalogFilters = (entry, isActiveFilter, isRequestFilter) => {
    if (isActiveFilter === undefined && isRequestFilter === undefined) return true;
    const cid = entry && entry.category_id;
    const doc =
        cid && typeof cid === 'object' && !(cid instanceof mongoose.Types.ObjectId) ? cid : null;
    if (!doc) return false;
    if (isActiveFilter !== undefined && Boolean(doc.is_active) !== isActiveFilter) return false;
    if (isRequestFilter !== undefined && Boolean(doc.is_request) !== isRequestFilter) return false;
    return true;
};

const applyCategoryCatalogFiltersToRecords = (records, isActiveFilter, isRequestFilter) => {
    if (isActiveFilter === undefined && isRequestFilter === undefined) return records;
    return records.map((row) => {
        const plain = row && typeof row.toObject === 'function' ? row.toObject() : { ...row };
        const list = Array.isArray(plain.categories_list) ? plain.categories_list : [];
        plain.categories_list = list.filter((e) =>
            categoryEntryMatchesCatalogFilters(e, isActiveFilter, isRequestFilter)
        );
        return plain;
    });
};

const resolveCatalogBoolFilters = (query) => {
    const a = parseOptionalQueryBool(query.is_active, 'is_active');
    if (!a.ok) return { ok: false, message: a.message };
    const r = parseOptionalQueryBool(query.is_request, 'is_request');
    if (!r.ok) return { ok: false, message: r.message };
    return {
        ok: true,
        isActiveFilter: a.present ? a.value : undefined,
        isRequestFilter: r.present ? r.value : undefined,
    };
};

const listPopulateFields = [
    { path: 'franchise_id', select: 'name admin_name is_active' },
    {
        path: 'categories_list',
        populate: {
            path: 'category_id',
            select: 'name desc image_url is_active is_request',
        },
    },
];

const loadUserFranchiseAuth = async (userId) => {
    if (!userId) return null;
    const user = await User.findOne({ _id: userId, deleted_at: null }).select('type franchise_id');
    if (!user) return null;
    const t = Number(user.type);
    const isSuper = t === USER_TYPE_SUPER_ADMIN || t === USER_TYPE_STAFF;
    const isFranchiseAdmin = t === USER_TYPE_ADMIN && user.franchise_id;
    const isEmployee = t === USER_TYPE_EMPLOYEE && user.franchise_id;
    return { user, isSuper, isFranchiseAdmin, isEmployee, franchise_id: user.franchise_id };
};

const ensureFranchise = async (franchiseOid) => {
    const franchise = await Franchise.findOne({ _id: franchiseOid, deleted_at: null }).select('admin_id');
    return franchise;
};

const ensureCategories = async (categoryIds) => {
    if (!categoryIds || categoryIds.length === 0) return true;
    const count = await Category.countDocuments({
        _id: { $in: categoryIds },
        deleted_at: null,
    });
    return count === categoryIds.length;
};

const list = async (query, userId) => {
    try {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const filter = { deleted_at: null };

        if (userId) {
            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');
            if (auth.isFranchiseAdmin || auth.isEmployee) {
                if (!auth.franchise_id) return fail(403, 'Access denied.');
                if (query.franchise_id) {
                    const parsed = parseObjectId(query.franchise_id, 'franchise_id');
                    if (!parsed.ok) return fail(400, parsed.message);
                    if (String(parsed.oid) !== String(auth.franchise_id)) {
                        return fail(403, 'Access denied.');
                    }
                }
                filter.franchise_id = auth.franchise_id;
            } else if (auth.isSuper) {
                if (query.franchise_id) {
                    const parsed = parseObjectId(query.franchise_id, 'franchise_id');
                    if (!parsed.ok) return fail(400, parsed.message);
                    filter.franchise_id = parsed.oid;
                }
            } else {
                return fail(403, 'Access denied.');
            }
        } else if (query.franchise_id) {
            const parsed = parseObjectId(query.franchise_id, 'franchise_id');
            if (!parsed.ok) return fail(400, parsed.message);
            filter.franchise_id = parsed.oid;
        }

        const filterFlags = resolveCatalogBoolFilters(query);
        if (!filterFlags.ok) return fail(400, filterFlags.message);

        const { data, totalCount, totalPages, currentPage } = await applyPagination(
            FranchiseCategory,
            filter,
            page,
            limit,
            { created_at: -1 },
            {},
            listPopulateFields
        );

        const records = applyCategoryCatalogFiltersToRecords(
            data,
            filterFlags.isActiveFilter,
            filterFlags.isRequestFilter
        );

        return ok(200, {
            message: 'Franchise category list fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage,
            records,
        });
    } catch (error) {
        console.error('franchiseCategory.list', error.message);
        return fail(500, 'Internal server error.');
    }
};

const create = async (body) => {
    try {
        const parsedFranchise = parseObjectId(body.franchise_id, 'franchise_id');
        if (!parsedFranchise.ok) return fail(400, parsedFranchise.message);

        const parsedCategories = parseCategoriesListInput(body.categories_list || [], 'categories_list');
        if (!parsedCategories.ok) return fail(400, parsedCategories.message);

        const franchise = await ensureFranchise(parsedFranchise.oid);
        if (!franchise) return fail(404, 'Franchise not found.');

        const catIds = parsedCategories.entries.map((e) => e.category_id);
        const validCategories = await ensureCategories(catIds);
        if (!validCategories) return fail(400, 'One or more category IDs are invalid or deleted.');

        const doc = new FranchiseCategory({
            franchise_id: parsedFranchise.oid,
            categories_list: parsedCategories.entries,
            active_categories: false,
            inactive_categories: false,
            order_number:
                body.order_number !== undefined && body.order_number !== null
                    ? Number(body.order_number)
                    : 0,
        });

        const saved = await doc.save();
        return ok(200, { message: 'Franchise category created successfully.', record: saved });
    } catch (error) {
        console.error('franchiseCategory.create', error.message);
        return fail(500, 'Internal server error.');
    }
};

const getById = async (id, userId, query = {}) => {
    try {
        const parsed = parseObjectId(id, 'id');
        if (!parsed.ok) return fail(400, parsed.message);
        const record = await FranchiseCategory.findOne({ _id: parsed.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');

        if (userId) {
            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');
            if (auth.isFranchiseAdmin || auth.isEmployee) {
                if (!auth.franchise_id || String(record.franchise_id) !== String(auth.franchise_id)) {
                    return fail(403, 'Access denied.');
                }
            } else if (!auth.isSuper) {
                return fail(403, 'Access denied.');
            }
        }

        const filterFlags = resolveCatalogBoolFilters(query);
        if (!filterFlags.ok) return fail(400, filterFlags.message);

        await record.populate(listPopulateFields);
        const [recordOut] = applyCategoryCatalogFiltersToRecords(
            [record],
            filterFlags.isActiveFilter,
            filterFlags.isRequestFilter
        );
        return ok(200, { message: 'Franchise category fetched successfully.', record: recordOut });
    } catch (error) {
        console.error('franchiseCategory.getById', error.message);
        return fail(500, 'Internal server error.');
    }
};

const update = async (id, body, userId) => {
    try {
        const parsed = parseObjectId(id, 'id');
        if (!parsed.ok) return fail(400, parsed.message);

        const record = await FranchiseCategory.findOne({ _id: parsed.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');

        if (body.franchise_id !== undefined) {
            const parsedFranchise = parseObjectId(body.franchise_id, 'franchise_id');
            if (!parsedFranchise.ok) return fail(400, parsedFranchise.message);
            const franchise = await ensureFranchise(parsedFranchise.oid);
            if (!franchise) return fail(404, 'Franchise not found.');
            record.franchise_id = parsedFranchise.oid;
        }

        if (body.categories_list !== undefined) {
            const parsedCategories = parseCategoriesListInput(body.categories_list, 'categories_list');
            if (!parsedCategories.ok) return fail(400, parsedCategories.message);
            const catIds = parsedCategories.entries.map((e) => e.category_id);
            const validCategories = await ensureCategories(catIds);
            if (!validCategories) return fail(400, 'One or more category IDs are invalid or deleted.');

            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');

            if (auth.isSuper) {
                record.categories_list = parsedCategories.entries;
            } else if (auth.isEmployee) {
                return fail(403, 'Franchise employees cannot update categories list.');
            } else if (auth.isFranchiseAdmin) {
                if (String(record.franchise_id) !== String(auth.franchise_id)) {
                    return fail(403, 'Access denied.');
                }
                const franchise = await Franchise.findOne({
                    _id: record.franchise_id,
                    deleted_at: null,
                }).select('categories');
                if (!franchise) return fail(404, 'Franchise not found.');
                const allowed = new Set((franchise.categories || []).map((id) => id.toString()));
                const existingNorm = normalizeStoredCategoriesList(record.categories_list);
                const existingById = new Map(
                    existingNorm.map((e) => [e.category_id.toString(), e.is_active])
                );
                const incomingKeys = new Set(parsedCategories.entries.map((e) => e.category_id.toString()));
                if (
                    existingById.size !== incomingKeys.size ||
                    ![...incomingKeys].every((k) => existingById.has(k))
                ) {
                    return fail(400, 'categories_list must include every mapped category.');
                }
                for (const ent of parsedCategories.entries) {
                    const idStr = ent.category_id.toString();
                    const prev = existingById.get(idStr);
                    if (!allowed.has(idStr) && Boolean(ent.is_active) !== Boolean(prev)) {
                        return fail(
                            403,
                            'You can only change status for categories assigned to your franchise.'
                        );
                    }
                }
                record.categories_list = parsedCategories.entries;
            } else {
                return fail(403, 'Access denied.');
            }
        }

        const isStatusEditRequest =
            body.active_categories !== undefined || body.inactive_categories !== undefined;

        if (isStatusEditRequest) {
            const franchise = await ensureFranchise(record.franchise_id);
            if (!franchise) return fail(404, 'Franchise not found.');
            if (String(franchise.admin_id) !== String(userId)) {
                return fail(
                    403,
                    'Only this franchise admin can update active/inactive category status.'
                );
            }
            if (body.active_categories !== undefined) {
                record.active_categories = Boolean(body.active_categories);
            }
            if (body.inactive_categories !== undefined) {
                record.inactive_categories = Boolean(body.inactive_categories);
            }
        }

        if (body.order_number !== undefined) {
            record.order_number = Number(body.order_number);
        }

        record.updated_at = new Date();
        const updated = await record.save();
        return ok(200, { message: 'Franchise category updated successfully.', record: updated });
    } catch (error) {
        console.error('franchiseCategory.update', error.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    list,
    create,
    getById,
    update,
};
