const mongoose = require('mongoose');
const FranchiseService = require('../models/franchise_service');
const Franchise = require('../models/franchise');
const Service = require('../models/service');
const User = require('../models/user');
const { applyPagination } = require('../utils/pagination');

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const USER_TYPE_ADMIN = 1;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

const parseObjectId = (raw, fieldName) => {
    if (raw instanceof mongoose.Types.ObjectId) return { ok: true, oid: raw };
    const value = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!value || !/^[a-fA-F0-9]{24}$/.test(value)) {
        return { ok: false, message: `${fieldName} must be a valid MongoDB ObjectId.` };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(value) };
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

const parseServicesListInput = (raw, fieldName) => {
    if (!Array.isArray(raw)) return { ok: false, message: `${fieldName} must be an array.` };
    const entries = [];
    const seen = new Set();
    for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        const isObjectShape =
            item !== null &&
            typeof item === 'object' &&
            !(item instanceof mongoose.Types.ObjectId) &&
            item.service_id !== undefined &&
            item.service_id !== null;

        if (isObjectShape) {
            const p = parseObjectId(item.service_id, `${fieldName}[${i}].service_id`);
            if (!p.ok) return p;
            const key = p.oid.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ service_id: p.oid, is_active: Boolean(item.is_active) });
        } else {
            const p = parseObjectId(item, `${fieldName}[${i}]`);
            if (!p.ok) return p;
            const key = p.oid.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ service_id: p.oid, is_active: true });
        }
    }
    return { ok: true, entries };
};

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

        const parsedServices = parseServicesListInput(body.services_list || [], 'services_list');
        if (!parsedServices.ok) return fail(400, parsedServices.message);

        const franchise = await ensureFranchise(parsedFranchise.oid);
        if (!franchise) return fail(404, 'Franchise not found.');

        const svcIds = parsedServices.entries.map((e) => e.service_id);
        const validServices = await ensureServices(svcIds);
        if (!validServices) return fail(400, 'One or more service IDs are invalid or deleted.');

        const doc = new FranchiseService({
            franchise_id: parsedFranchise.oid,
            services_list: parsedServices.entries,
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
            const parsedServices = parseServicesListInput(body.services_list, 'services_list');
            if (!parsedServices.ok) return fail(400, parsedServices.message);
            const svcIds = parsedServices.entries.map((e) => e.service_id);
            const validServices = await ensureServices(svcIds);
            if (!validServices) return fail(400, 'One or more service IDs are invalid or deleted.');

            const auth = await loadUserFranchiseAuth(userId);
            if (!auth) return fail(403, 'Access denied.');

            if (auth.isSuper) {
                record.services_list = parsedServices.entries;
            } else if (auth.isEmployee) {
                return fail(403, 'Franchise employees cannot update services list.');
            } else if (auth.isFranchiseAdmin) {
                if (String(record.franchise_id) !== String(auth.franchise_id)) {
                    return fail(403, 'Access denied.');
                }
                const franchise = await Franchise.findOne({
                    _id: record.franchise_id,
                    deleted_at: null,
                }).select('services');
                if (!franchise) return fail(404, 'Franchise not found.');
                const allowed = new Set((franchise.services || []).map((id) => id.toString()));
                const existingNorm = normalizeStoredServicesList(record.services_list);
                const existingById = new Map(
                    existingNorm.map((e) => [e.service_id.toString(), e.is_active])
                );
                const incomingKeys = new Set(parsedServices.entries.map((e) => e.service_id.toString()));
                if (
                    existingById.size !== incomingKeys.size ||
                    ![...incomingKeys].every((k) => existingById.has(k))
                ) {
                    return fail(400, 'services_list must include every mapped service.');
                }
                for (const ent of parsedServices.entries) {
                    const idStr = ent.service_id.toString();
                    const prev = existingById.get(idStr);
                    if (!allowed.has(idStr) && Boolean(ent.is_active) !== Boolean(prev)) {
                        return fail(
                            403,
                            'You can only change status for services assigned to your franchise.'
                        );
                    }
                }
                record.services_list = parsedServices.entries;
            } else {
                return fail(403, 'Access denied.');
            }
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
