const mongoose = require('mongoose');
const { fieldLabel } = require('../utils/field_labels');
const SubscriptionPlan = require('../models/subscription_plan');
const PLAN_NAMES = SubscriptionPlan.PLAN_NAMES;
const DURATION_TYPES = SubscriptionPlan.DURATION_TYPES;
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');

const parseObjectId = (raw, fieldName = 'id') => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!s || !/^[a-fA-F0-9]{24}$/.test(s)) {
        return {
            ok: false,
            message: `${fieldLabel(fieldName)} must be a valid MongoDB ObjectId (24 hex characters).`,
        };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const parseNumberField = (value, fieldName, { allowZero = true } = {}) => {
    if (value === undefined || value === null || value === '') {
        return { ok: false, message: `${fieldLabel(fieldName)} is required.` };
    }
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (Number.isNaN(n)) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be a valid number.` };
    }
    if (!allowZero && n === 0) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be greater than zero.` };
    }
    return { ok: true, n };
};

const parseOptionalPriority = (value) => {
    if (value === undefined || value === null || value === '') {
        return { ok: true, priority: null };
    }
    const p = parseNumberField(value, 'priority', { allowZero: true });
    if (!p.ok) return p;
    return { ok: true, priority: p.n };
};

const listSubscriptionPlans = async (query) => {
    try {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const filter = {
            deleted_at: null,
            ...(query.is_active !== undefined && {
                is_active: parseBoolean(query.is_active),
            }),
        };
        if (query.plan_name && String(query.plan_name).trim()) {
            const name = String(query.plan_name).trim().toLowerCase();
            if (PLAN_NAMES.includes(name)) {
                filter.plan_name = name;
            }
        }
        if (query.duration_type && DURATION_TYPES.includes(query.duration_type)) {
            filter.duration_type = query.duration_type;
        }

        const sort = { priority: 1, created_at: query.sort !== undefined ? parseInt(query.sort, 10) : -1 };

        const { data: rows, totalCount, totalPages, currentPage } = await applyPagination(
            SubscriptionPlan,
            filter,
            page,
            limit,
            sort
        );

        return ok(200, {
            message: 'Subscription plan list fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage,
            records: rows,
        });
    } catch (err) {
        console.log('listSubscriptionPlans', err.message);
        return fail(500, 'Internal server error.');
    }
};

const createSubscriptionPlan = async (body) => {
    try {
        const { plan_description, price, duration, priority, is_active } = body;
        const plan_name = String(body.plan_name).trim().toLowerCase();
        const duration_type = String(body.duration_type).trim().toLowerCase();

        const existing = await SubscriptionPlan.findOne({
            plan_name,
            deleted_at: null,
        });
        if (existing) {
            return fail(409, 'A subscription plan with this tier name already exists.');
        }

        const pPrice = parseNumberField(price, 'price');
        if (!pPrice.ok) return fail(400, pPrice.message);
        if (pPrice.n < 0) return fail(400, 'price cannot be negative.');

        const pDuration = parseNumberField(duration, 'duration', { allowZero: false });
        if (!pDuration.ok) return fail(400, pDuration.message);
        if (pDuration.n <= 0) return fail(400, 'duration must be greater than zero.');

        const pPriority = parseOptionalPriority(priority);
        if (!pPriority.ok) return fail(400, pPriority.message);

        const doc = new SubscriptionPlan({
            plan_name,
            plan_description: String(plan_description).trim(),
            price: pPrice.n,
            duration: pDuration.n,
            duration_type,
            priority: pPriority.priority,
            is_active,
        });

        const saved = await doc.save();
        return ok(200, { message: 'Subscription plan created successfully.', record: saved });
    } catch (error) {
        console.error('createSubscriptionPlan', error.message);
        return fail(500, 'Internal server error.');
    }
};

const updateSubscriptionPlan = async (id, body) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const plan = await SubscriptionPlan.findById(pId.oid);
        if (!plan) return fail(404, 'No record found');

        if (body.plan_name !== undefined) {
            const nextName = String(body.plan_name).trim().toLowerCase();
            const existing = await SubscriptionPlan.findOne({
                plan_name: nextName,
                deleted_at: null,
                _id: { $ne: plan._id },
            });
            if (existing) {
                return fail(409, 'A subscription plan with this tier name already exists.');
            }
            plan.plan_name = nextName;
        }

        if (body.plan_description !== undefined) {
            plan.plan_description = String(body.plan_description).trim();
        }

        if (body.price !== undefined) {
            const pPrice = parseNumberField(body.price, 'price');
            if (!pPrice.ok) return fail(400, pPrice.message);
            if (pPrice.n < 0) return fail(400, 'price cannot be negative.');
            plan.price = pPrice.n;
        }

        if (body.duration !== undefined) {
            const pDuration = parseNumberField(body.duration, 'duration', { allowZero: false });
            if (!pDuration.ok) return fail(400, pDuration.message);
            if (pDuration.n <= 0) return fail(400, 'duration must be greater than zero.');
            plan.duration = pDuration.n;
        }

        if (body.duration_type !== undefined) {
            plan.duration_type = String(body.duration_type).trim().toLowerCase();
        }

        if (body.priority !== undefined) {
            const pPriority = parseOptionalPriority(body.priority);
            if (!pPriority.ok) return fail(400, pPriority.message);
            plan.priority = pPriority.priority;
        }

        if (body.is_active !== undefined) {
            plan.is_active = body.is_active;
        }

        plan.updated_at = new Date();
        const updated = await plan.save();
        return ok(200, { message: 'Subscription plan updated successfully', record: updated });
    } catch (error) {
        console.error('updateSubscriptionPlan', error.message);
        return fail(500, 'Internal server error.');
    }
};

const getSubscriptionPlanById = async (id) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const record = await SubscriptionPlan.findOne({ _id: pId.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');
        return ok(200, { message: 'Subscription plan fetched successfully', record });
    } catch (error) {
        console.error('getSubscriptionPlanById', error);
        return fail(500, 'Internal server error.');
    }
};

const softDeleteSubscriptionPlan = async (id) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const row = await SubscriptionPlan.findById(pId.oid);
        if (!row) return fail(404, 'No record found');
        if (row.deleted_at) return fail(400, 'Subscription plan is already deleted');

        row.deleted_at = new Date();
        await row.save();
        return ok(200, { message: 'Subscription plan deleted successfully' });
    } catch (error) {
        console.error('softDeleteSubscriptionPlan', error);
        return fail(500, 'Internal server error.');
    }
};

const importSubscriptionPlans = async (records) => {
    if (!records || !Array.isArray(records)) {
        return fail(400, 'Invalid input. Expected an array of records.');
    }
    if (records.length === 0) {
        return fail(400, 'Please add records in excel sheet.');
    }

    try {
        const toInsert = [];
        for (const rec of records) {
            if (
                !rec.plan_name ||
                rec.plan_description === undefined ||
                rec.price === undefined ||
                rec.duration === undefined ||
                !rec.duration_type ||
                rec.is_active === undefined
            ) {
                return fail(
                    400,
                    'Each record must include plan_name, plan_description, price, duration, duration_type, and is_active.'
                );
            }

            const planNameNorm = String(rec.plan_name).trim().toLowerCase();
            const durationTypeNorm = String(rec.duration_type).trim().toLowerCase();
            if (!PLAN_NAMES.includes(planNameNorm)) {
                return fail(400, `Invalid plan name for row: ${rec.plan_name}`);
            }
            if (!DURATION_TYPES.includes(durationTypeNorm)) {
                return fail(400, `Invalid duration type for plan: ${rec.plan_name}`);
            }

            const pPrice = parseNumberField(rec.price, 'price');
            if (!pPrice.ok) return fail(400, `${pPrice.message} (plan: ${rec.plan_name})`);
            if (pPrice.n < 0) {
                return fail(400, `price cannot be negative. (plan: ${rec.plan_name})`);
            }

            const pDuration = parseNumberField(rec.duration, 'duration', { allowZero: false });
            if (!pDuration.ok) return fail(400, `${pDuration.message} (plan: ${rec.plan_name})`);
            if (pDuration.n <= 0) {
                return fail(400, `duration must be greater than zero. (plan: ${rec.plan_name})`);
            }

            const pPriority = parseOptionalPriority(rec.priority);
            if (!pPriority.ok) return fail(400, `${pPriority.message} (plan: ${rec.plan_name})`);

            toInsert.push({
                plan_name: planNameNorm,
                plan_description: String(rec.plan_description).trim(),
                price: pPrice.n,
                duration: pDuration.n,
                duration_type: durationTypeNorm,
                priority: pPriority.priority,
                is_active: rec.is_active,
            });
        }

        const seen = new Set();
        for (const r of toInsert) {
            if (seen.has(r.plan_name)) {
                return fail(409, 'Duplicate plan name entries in import file.');
            }
            seen.add(r.plan_name);
        }

        const existing = await SubscriptionPlan.find({
            deleted_at: null,
            plan_name: { $in: toInsert.map((r) => r.plan_name) },
        }).select('plan_name');

        if (existing.length > 0) {
            const lines = existing.map((e) => e.plan_name).join('\n');
            return fail(409, `Duplicate records found.\n${lines}`);
        }

        const result = await SubscriptionPlan.insertMany(toInsert, { ordered: false });
        return ok(200, {
            message: `${result.length} records added successfully!`,
            records: result,
        });
    } catch (error) {
        console.log('importSubscriptionPlans', error.message);
        return fail(500, 'Internal server error.', { error: error.message });
    }
};

const listAllSubscriptionPlans = async () => {
    try {
        const records = await SubscriptionPlan.find({ deleted_at: null })
            .sort({ priority: 1, created_at: -1 })
            .lean();
        return ok(200, {
            message: 'Subscription plans fetched successfully.',
            records,
        });
    } catch (err) {
        console.log('listAllSubscriptionPlans', err.message);
        return fail(500, 'Internal server error.');
    }
};

const listSubscriptionPlansForDropdown = async (query) => {
    try {
        const filter = {
            deleted_at: null,
            is_active: true,
        };

        if (query.duration_type && DURATION_TYPES.includes(query.duration_type)) {
            filter.duration_type = query.duration_type;
        }

        const sort = { priority: 1, created_at: -1 };

        const { data: rows } = await applyDropDownFilter(SubscriptionPlan, filter, sort);
        return ok(200, {
            message: 'Subscription plan list fetched successfully.',
            records: rows,
        });
    } catch (err) {
        console.log('listSubscriptionPlansForDropdown', err.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    listSubscriptionPlans,
    listAllSubscriptionPlans,
    createSubscriptionPlan,
    updateSubscriptionPlan,
    getSubscriptionPlanById,
    softDeleteSubscriptionPlan,
    importSubscriptionPlans,
    listSubscriptionPlansForDropdown,
};
