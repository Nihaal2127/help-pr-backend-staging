const mongoose = require('mongoose');
const FinancialOrder = require('../models/financial_order');
const {
    ORDER_STATUS,
    PARTNER_PAYMENT_STATUS,
    CUSTOMER_PAYMENT_STATUS,
} = require('../models/financial_order');
const Franchise = require('../models/franchise');
const Order = require('../models/order');
const User = require('../models/user');
const { applyPagination } = require('../utils/pagination');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const { getFinancialOrderUniqueId } = require('../helper/id_generator');

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const FINANCIAL_ORDER_STRING_SORT_FIELDS = ['user_name', 'partner_name', 'service_name'];
const FINANCIAL_ORDER_LIST_SORT_FIELDS = [
    ...FINANCIAL_ORDER_STRING_SORT_FIELDS,
    'service_date',
    'created_at',
    'total_price',
];
const LIST_COLLATION = { locale: 'en', strength: 2 };

const parseObjectId = (raw, fieldName = 'id') => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!s || !/^[a-fA-F0-9]{24}$/.test(s)) {
        return {
            ok: false,
            message: `${fieldName} must be a valid MongoDB ObjectId (24 hex characters).`,
        };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const parseOptionalObjectId = (raw, fieldName) => {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return { ok: true, oid: null };
    }
    return parseObjectId(raw, fieldName);
};

const parseNumber = (value, fieldName, { required = false, min = 0 } = {}) => {
    if (value === undefined || value === null || value === '') {
        if (required) return { ok: false, message: `${fieldName} is required.` };
        return { ok: true, value: undefined };
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < min) {
        return { ok: false, message: `${fieldName} must be a valid number${min > 0 ? ` >= ${min}` : ''}.` };
    }
    return { ok: true, value: n };
};

const parseDate = (value, fieldName, { required = false } = {}) => {
    if (value === undefined || value === null || value === '') {
        if (required) return { ok: false, message: `${fieldName} is required.` };
        return { ok: true, value: undefined };
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        return { ok: false, message: `${fieldName} must be a valid date.` };
    }
    return { ok: true, value: d };
};

const validateEnum = (value, allowed, fieldName, { required = false } = {}) => {
    if (value === undefined || value === null || value === '') {
        if (required) return { ok: false, message: `${fieldName} is required.` };
        return { ok: true, value: undefined };
    }
    const v = String(value).trim();
    if (!allowed.includes(v)) {
        return {
            ok: false,
            message: `${fieldName} must be one of: ${allowed.join(', ')}.`,
        };
    }
    return { ok: true, value: v };
};

const formatServiceDate = (date) => {
    if (!date) return null;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
};

const shapeFinancialOrderRecord = (doc) => {
    if (!doc) return null;
    const row = doc.toObject ? doc.toObject() : doc;
    return {
        _id: row._id,
        order_unique_id: row.order_unique_id,
        order_id: row.order_id || null,
        franchise_id: row.franchise_id || null,
        user_id: row.user_id,
        user_name: row.user_name,
        partner_id: row.partner_id,
        partner_name: row.partner_name,
        service_name: row.service_name,
        service_date: formatServiceDate(row.service_date),
        total_price: row.total_price,
        commission_percentage: row.commission_percentage,
        tax_percentage: row.tax_percentage,
        customer_paid_amount: row.customer_paid_amount,
        customer_pending_amount: row.customer_pending_amount,
        total_service_amount: row.total_service_amount,
        paid_to_partner: row.paid_to_partner,
        pending_to_partner: row.pending_to_partner,
        customer_payment_status: row.customer_payment_status,
        partner_payment_status: row.partner_payment_status,
        order_status: row.order_status,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
};

const buildListSort = (query) => {
    const sortByRaw = query.sort_by ?? query.sortBy;
    const orderRaw = String(query.sort_order ?? query.sortOrder ?? '').toLowerCase();

    if (!sortByRaw) {
        return { sort: { created_at: -1 }, collation: undefined };
    }

    const sortBy = FINANCIAL_ORDER_LIST_SORT_FIELDS.includes(sortByRaw) ? sortByRaw : 'created_at';

    let direction;
    if (orderRaw === 'asc' || orderRaw === '1') direction = 1;
    else if (orderRaw === 'desc' || orderRaw === '-1') direction = -1;
    else direction = sortBy === 'created_at' ? -1 : 1;

    const sort = { [sortBy]: direction };
    const collation = FINANCIAL_ORDER_STRING_SORT_FIELDS.includes(sortBy)
        ? LIST_COLLATION
        : undefined;

    return { sort, collation };
};

const validateReferences = async ({ order_id, franchise_id, user_id, partner_id }) => {
    if (order_id) {
        const order = await Order.findOne({ _id: order_id, deleted_at: null }).lean();
        if (!order) return fail(404, 'Order not found.');
    }
    if (franchise_id) {
        const franchise = await Franchise.findOne({ _id: franchise_id, deleted_at: null }).lean();
        if (!franchise) return fail(404, 'Franchise not found.');
    }
    const user = await User.findOne({ _id: user_id, deleted_at: null }).lean();
    if (!user) return fail(404, 'User not found.');
    const partner = await User.findOne({ _id: partner_id, deleted_at: null }).lean();
    if (!partner) return fail(404, 'Partner not found.');
    return { ok: true };
};

const listFinancialOrders = async (query) => {
    try {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const filter = { deleted_at: null };

        const searchRaw = query.search ?? query.keyword;
        if (searchRaw !== undefined && searchRaw !== null) {
            const s = String(Array.isArray(searchRaw) ? searchRaw[0] : searchRaw).trim();
            if (s) {
                const pattern = new RegExp(sanitizeInput(s), 'i');
                filter.$or = [
                    { order_unique_id: { $regex: pattern } },
                    { user_name: { $regex: pattern } },
                    { partner_name: { $regex: pattern } },
                    { service_name: { $regex: pattern } },
                ];
            }
        }

        if (query.order_status) {
            const v = validateEnum(query.order_status, ORDER_STATUS, 'order_status', { required: true });
            if (!v.ok) return fail(400, v.message);
            filter.order_status = v.value;
        }
        if (query.partner_payment_status) {
            const v = validateEnum(
                query.partner_payment_status,
                PARTNER_PAYMENT_STATUS,
                'partner_payment_status',
                { required: true }
            );
            if (!v.ok) return fail(400, v.message);
            filter.partner_payment_status = v.value;
        }
        if (query.customer_payment_status) {
            const v = validateEnum(
                query.customer_payment_status,
                CUSTOMER_PAYMENT_STATUS,
                'customer_payment_status',
                { required: true }
            );
            if (!v.ok) return fail(400, v.message);
            filter.customer_payment_status = v.value;
        }
        if (query.franchise_id) {
            const p = parseObjectId(query.franchise_id, 'franchise_id');
            if (!p.ok) return fail(400, p.message);
            filter.franchise_id = p.oid;
        }

        if (query.from_date || query.to_date) {
            filter.service_date = {};
            if (query.from_date) {
                const from = parseDate(query.from_date, 'from_date', { required: true });
                if (!from.ok) return fail(400, from.message);
                filter.service_date.$gte = from.value;
            }
            if (query.to_date) {
                const to = parseDate(query.to_date, 'to_date', { required: true });
                if (!to.ok) return fail(400, to.message);
                const end = new Date(to.value);
                end.setHours(23, 59, 59, 999);
                filter.service_date.$lte = end;
            }
        }

        const { sort, collation } = buildListSort(query);

        const { data: rows, totalCount, totalPages, currentPage } = await applyPagination(
            FinancialOrder,
            filter,
            page,
            limit,
            sort,
            {},
            [],
            collation ? { collation } : {}
        );

        return ok(200, {
            message: 'Financial orders fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage,
            records: rows.map(shapeFinancialOrderRecord),
        });
    } catch (err) {
        console.error('listFinancialOrders', err.message);
        return fail(500, 'Internal server error.');
    }
};

const createFinancialOrder = async (body) => {
    try {
        const pUser = parseObjectId(body.user_id, 'user_id');
        if (!pUser.ok) return fail(400, pUser.message);
        const pPartner = parseObjectId(body.partner_id, 'partner_id');
        if (!pPartner.ok) return fail(400, pPartner.message);
        const pOrder = await parseOptionalObjectId(body.order_id, 'order_id');
        if (!pOrder.ok) return fail(400, pOrder.message);
        const pFranchise = await parseOptionalObjectId(body.franchise_id, 'franchise_id');
        if (!pFranchise.ok) return fail(400, pFranchise.message);

        const refCheck = await validateReferences({
            order_id: pOrder.oid,
            franchise_id: pFranchise.oid,
            user_id: pUser.oid,
            partner_id: pPartner.oid,
        });
        if (!refCheck.ok) return refCheck;

        const serviceDate = parseDate(body.service_date, 'service_date', { required: true });
        if (!serviceDate.ok) return fail(400, serviceDate.message);

        const orderStatus = validateEnum(body.order_status, ORDER_STATUS, 'order_status', {
            required: true,
        });
        if (!orderStatus.ok) return fail(400, orderStatus.message);
        const partnerStatus = validateEnum(
            body.partner_payment_status,
            PARTNER_PAYMENT_STATUS,
            'partner_payment_status',
            { required: true }
        );
        if (!partnerStatus.ok) return fail(400, partnerStatus.message);
        const customerStatus = validateEnum(
            body.customer_payment_status,
            CUSTOMER_PAYMENT_STATUS,
            'customer_payment_status',
            { required: true }
        );
        if (!customerStatus.ok) return fail(400, customerStatus.message);

        const numericFields = [
            ['total_price', { required: true }],
            ['commission_percentage', { required: true }],
            ['tax_percentage', { required: true }],
            ['customer_paid_amount', { required: true }],
            ['customer_pending_amount', { required: true }],
            ['total_service_amount', { required: true }],
            ['paid_to_partner', { required: true }],
            ['pending_to_partner', { required: true }],
        ];
        const numbers = {};
        for (const [field, opts] of numericFields) {
            const parsed = parseNumber(body[field], field, opts);
            if (!parsed.ok) return fail(400, parsed.message);
            numbers[field] = parsed.value;
        }

        let orderUniqueId =
            body.order_unique_id !== undefined && body.order_unique_id !== null
                ? String(body.order_unique_id).trim()
                : '';
        if (!orderUniqueId) {
            orderUniqueId = await getFinancialOrderUniqueId();
        }

        const duplicate = await FinancialOrder.findOne({
            order_unique_id: orderUniqueId,
            deleted_at: null,
        });
        if (duplicate) {
            return fail(409, 'order_unique_id already exists.');
        }

        const doc = new FinancialOrder({
            order_unique_id: orderUniqueId,
            order_id: pOrder.oid,
            franchise_id: pFranchise.oid,
            user_id: pUser.oid,
            user_name: String(body.user_name).trim(),
            partner_id: pPartner.oid,
            partner_name: String(body.partner_name).trim(),
            service_name: String(body.service_name).trim(),
            service_date: serviceDate.value,
            ...numbers,
            customer_payment_status: customerStatus.value,
            partner_payment_status: partnerStatus.value,
            order_status: orderStatus.value,
        });

        const saved = await doc.save();
        return ok(200, {
            message: 'Financial order created successfully.',
            record: shapeFinancialOrderRecord(saved),
        });
    } catch (err) {
        console.error('createFinancialOrder', err.message);
        return fail(500, 'Internal server error.');
    }
};

const updateFinancialOrder = async (id, body) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const record = await FinancialOrder.findOne({ _id: pId.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');

        const updateData = { ...body };
        delete updateData.order_unique_id;

        if (body.user_id !== undefined) {
            const p = parseObjectId(body.user_id, 'user_id');
            if (!p.ok) return fail(400, p.message);
            record.user_id = p.oid;
            delete updateData.user_id;
        }
        if (body.partner_id !== undefined) {
            const p = parseObjectId(body.partner_id, 'partner_id');
            if (!p.ok) return fail(400, p.message);
            record.partner_id = p.oid;
            delete updateData.partner_id;
        }
        if (body.order_id !== undefined) {
            const p = await parseOptionalObjectId(body.order_id, 'order_id');
            if (!p.ok) return fail(400, p.message);
            record.order_id = p.oid;
            delete updateData.order_id;
        }
        if (body.franchise_id !== undefined) {
            const p = await parseOptionalObjectId(body.franchise_id, 'franchise_id');
            if (!p.ok) return fail(400, p.message);
            record.franchise_id = p.oid;
            delete updateData.franchise_id;
        }

        const refCheck = await validateReferences({
            order_id: record.order_id,
            franchise_id: record.franchise_id,
            user_id: record.user_id,
            partner_id: record.partner_id,
        });
        if (!refCheck.ok) return refCheck;

        if (body.service_date !== undefined) {
            const d = parseDate(body.service_date, 'service_date', { required: true });
            if (!d.ok) return fail(400, d.message);
            record.service_date = d.value;
            delete updateData.service_date;
        }

        const enumFields = [
            ['order_status', ORDER_STATUS],
            ['partner_payment_status', PARTNER_PAYMENT_STATUS],
            ['customer_payment_status', CUSTOMER_PAYMENT_STATUS],
        ];
        for (const [field, allowed] of enumFields) {
            if (body[field] !== undefined) {
                const v = validateEnum(body[field], allowed, field, { required: true });
                if (!v.ok) return fail(400, v.message);
                record[field] = v.value;
                delete updateData[field];
            }
        }

        const numericFields = [
            'total_price',
            'commission_percentage',
            'tax_percentage',
            'customer_paid_amount',
            'customer_pending_amount',
            'total_service_amount',
            'paid_to_partner',
            'pending_to_partner',
        ];
        for (const field of numericFields) {
            if (body[field] !== undefined) {
                const parsed = parseNumber(body[field], field, { required: true });
                if (!parsed.ok) return fail(400, parsed.message);
                record[field] = parsed.value;
                delete updateData[field];
            }
        }

        const stringFields = ['user_name', 'partner_name', 'service_name'];
        for (const field of stringFields) {
            if (body[field] !== undefined) {
                record[field] = String(body[field]).trim();
                delete updateData[field];
            }
        }

        record.updated_at = new Date();
        const updated = await record.save();
        return ok(200, {
            message: 'Financial order updated successfully.',
            record: shapeFinancialOrderRecord(updated),
        });
    } catch (err) {
        console.error('updateFinancialOrder', err.message);
        return fail(500, 'Internal server error.');
    }
};

const getFinancialOrderById = async (id) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const record = await FinancialOrder.findOne({ _id: pId.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');

        return ok(200, {
            message: 'Financial order fetched successfully.',
            record: shapeFinancialOrderRecord(record),
        });
    } catch (err) {
        console.error('getFinancialOrderById', err.message);
        return fail(500, 'Internal server error.');
    }
};

const softDeleteFinancialOrder = async (id) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const record = await FinancialOrder.findOne({ _id: pId.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');

        record.deleted_at = new Date();
        record.updated_at = new Date();
        await record.save();
        return ok(200, { message: 'Financial order deleted successfully.' });
    } catch (err) {
        console.error('softDeleteFinancialOrder', err.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    listFinancialOrders,
    createFinancialOrder,
    updateFinancialOrder,
    getFinancialOrderById,
    softDeleteFinancialOrder,
    shapeFinancialOrderRecord,
};
