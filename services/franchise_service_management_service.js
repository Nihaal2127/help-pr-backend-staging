const mongoose = require('mongoose');
const FranchiseService = require('../models/franchise_service');
const Franchise = require('../models/franchise');
const Service = require('../models/service');
const { applyPagination } = require('../utils/pagination');

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const parseObjectId = (raw, fieldName) => {
    if (raw instanceof mongoose.Types.ObjectId) return { ok: true, oid: raw };
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
    return Franchise.findOne({ _id: franchiseOid, deleted_at: null }).select('admin_id');
};

const ensureServices = async (serviceIds) => {
    if (!serviceIds || serviceIds.length === 0) return true;
    const count = await Service.countDocuments({
        _id: { $in: serviceIds },
        deleted_at: null,
    });
    return count === serviceIds.length;
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
            FranchiseService,
            filter,
            page,
            limit,
            { created_at: -1 }
        );

        return ok(200, {
            message: 'Franchise service list fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage,
            records: data,
        });
    } catch (error) {
        console.error('franchiseService.list', error.message);
        return fail(500, 'Internal server error.');
    }
};

const create = async (body) => {
    try {
        const parsedFranchise = parseObjectId(body.franchise_id, 'franchise_id');
        if (!parsedFranchise.ok) return fail(400, parsedFranchise.message);

        const parsedServices = parseObjectIdArray(body.services_list || [], 'services_list');
        if (!parsedServices.ok) return fail(400, parsedServices.message);

        const franchise = await ensureFranchise(parsedFranchise.oid);
        if (!franchise) return fail(404, 'Franchise not found.');

        const validServices = await ensureServices(parsedServices.ids);
        if (!validServices) return fail(400, 'One or more service IDs are invalid or deleted.');

        const doc = new FranchiseService({
            franchise_id: parsedFranchise.oid,
            services_list: parsedServices.ids,
            active_services: false,
            inactive_services: false,
            order_number:
                body.order_number !== undefined && body.order_number !== null
                    ? Number(body.order_number)
                    : 0,
        });

        const saved = await doc.save();
        return ok(200, { message: 'Franchise service created successfully.', record: saved });
    } catch (error) {
        console.error('franchiseService.create', error.message);
        return fail(500, 'Internal server error.');
    }
};

const getById = async (id) => {
    try {
        const parsed = parseObjectId(id, 'id');
        if (!parsed.ok) return fail(400, parsed.message);
        const record = await FranchiseService.findOne({ _id: parsed.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');
        return ok(200, { message: 'Franchise service fetched successfully.', record });
    } catch (error) {
        console.error('franchiseService.getById', error.message);
        return fail(500, 'Internal server error.');
    }
};

const update = async (id, body, userId) => {
    try {
        const parsed = parseObjectId(id, 'id');
        if (!parsed.ok) return fail(400, parsed.message);

        const record = await FranchiseService.findOne({ _id: parsed.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');

        if (body.franchise_id !== undefined) {
            const parsedFranchise = parseObjectId(body.franchise_id, 'franchise_id');
            if (!parsedFranchise.ok) return fail(400, parsedFranchise.message);
            const franchise = await ensureFranchise(parsedFranchise.oid);
            if (!franchise) return fail(404, 'Franchise not found.');
            record.franchise_id = parsedFranchise.oid;
        }

        if (body.services_list !== undefined) {
            const parsedServices = parseObjectIdArray(body.services_list, 'services_list');
            if (!parsedServices.ok) return fail(400, parsedServices.message);
            const validServices = await ensureServices(parsedServices.ids);
            if (!validServices) return fail(400, 'One or more service IDs are invalid or deleted.');
            record.services_list = parsedServices.ids;
        }

        const isStatusEditRequest =
            body.active_services !== undefined || body.inactive_services !== undefined;

        if (isStatusEditRequest) {
            const franchise = await ensureFranchise(record.franchise_id);
            if (!franchise) return fail(404, 'Franchise not found.');
            if (String(franchise.admin_id) !== String(userId)) {
                return fail(
                    403,
                    'Only this franchise admin can update active/inactive service status.'
                );
            }
            if (body.active_services !== undefined) {
                record.active_services = Boolean(body.active_services);
            }
            if (body.inactive_services !== undefined) {
                record.inactive_services = Boolean(body.inactive_services);
            }
        }

        if (body.order_number !== undefined) {
            record.order_number = Number(body.order_number);
        }

        record.updated_at = new Date();
        const updated = await record.save();
        return ok(200, { message: 'Franchise service updated successfully.', record: updated });
    } catch (error) {
        console.error('franchiseService.update', error.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    list,
    create,
    getById,
    update,
};
