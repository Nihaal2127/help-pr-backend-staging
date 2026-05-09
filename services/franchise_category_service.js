const mongoose = require('mongoose');
const FranchiseCategory = require('../models/franchise_category');
const Franchise = require('../models/franchise');
const Category = require('../models/category');
const { applyPagination } = require('../utils/pagination');

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

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

const parseObjectIdArray = (raw, fieldName) => {
    if (!Array.isArray(raw)) return { ok: false, message: `${fieldName} must be an array.` };
    const unique = new Set();
    const ids = [];
    for (const item of raw) {
        const parsed = parseObjectId(item, fieldName);
        if (!parsed.ok) return parsed;
        const key = parsed.oid.toString();
        if (!unique.has(key)) {
            unique.add(key);
            ids.push(parsed.oid);
        }
    }
    return { ok: true, ids };
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

const list = async (query) => {
    try {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const filter = { deleted_at: null };

        if (query.franchise_id) {
            const parsed = parseObjectId(query.franchise_id, 'franchise_id');
            if (!parsed.ok) return fail(400, parsed.message);
            filter.franchise_id = parsed.oid;
        }

        const { data, totalCount, totalPages, currentPage } = await applyPagination(
            FranchiseCategory,
            filter,
            page,
            limit,
            { created_at: -1 }
        );

        return ok(200, {
            message: 'Franchise category list fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage,
            records: data,
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

        const parsedCategories = parseObjectIdArray(body.categories_list || [], 'categories_list');
        if (!parsedCategories.ok) return fail(400, parsedCategories.message);

        const franchise = await ensureFranchise(parsedFranchise.oid);
        if (!franchise) return fail(404, 'Franchise not found.');

        const validCategories = await ensureCategories(parsedCategories.ids);
        if (!validCategories) return fail(400, 'One or more category IDs are invalid or deleted.');

        const doc = new FranchiseCategory({
            franchise_id: parsedFranchise.oid,
            categories_list: parsedCategories.ids,
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

const getById = async (id) => {
    try {
        const parsed = parseObjectId(id, 'id');
        if (!parsed.ok) return fail(400, parsed.message);
        const record = await FranchiseCategory.findOne({ _id: parsed.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');
        return ok(200, { message: 'Franchise category fetched successfully.', record });
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
            const parsedCategories = parseObjectIdArray(body.categories_list, 'categories_list');
            if (!parsedCategories.ok) return fail(400, parsedCategories.message);
            const validCategories = await ensureCategories(parsedCategories.ids);
            if (!validCategories) return fail(400, 'One or more category IDs are invalid or deleted.');
            record.categories_list = parsedCategories.ids;
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
