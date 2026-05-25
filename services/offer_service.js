const mongoose = require('mongoose');
const { fieldLabel } = require('../utils/field_labels');
const Offer = require('../models/offer');
const { getOfferId } = require('../helper/id_generator');
const OFFER_TYPES = Offer.OFFER_TYPES;
const { applyPagination } = require('../utils/pagination');
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

const parseNumberField = (value, fieldName) => {
    if (value === undefined || value === null || value === '') {
        return { ok: false, message: `${fieldLabel(fieldName)} is required.` };
    }
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (Number.isNaN(n)) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be a valid number.` };
    }
    return { ok: true, n };
};

const parseDateField = (value, fieldName) => {
    if (value === undefined || value === null || value === '') {
        return { ok: false, message: `${fieldLabel(fieldName)} is required.` };
    }
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be a valid date.` };
    }
    return { ok: true, d };
};

const formatValidationError = (error) => {
    if (error?.name !== 'ValidationError' || !error.errors) {
        return null;
    }
    return Object.values(error.errors)
        .map((e) => e.message)
        .join(' ');
};

const validateDateRange = (startDate, endDate) => {
    if (startDate > endDate) {
        return 'end_date must be on or after start_date.';
    }
    return null;
};

const ALLOWED_SORT_FIELDS = {
    name: 'name',
    value: 'value',
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findOfferByNameInsensitive = async (name, excludeObjectId = null) => {
    const nameTrimmed = String(name).trim();
    if (!nameTrimmed) return null;
    const filter = {
        deleted_at: null,
        name: { $regex: `^${escapeRegex(nameTrimmed)}$`, $options: 'i' },
    };
    if (excludeObjectId) {
        filter._id = { $ne: excludeObjectId };
    }
    return Offer.findOne(filter);
};

const parseOptionalQueryDate = (value, fieldName) => {
    if (value === undefined || value === null || String(value).trim() === '') {
        return { ok: true, d: null };
    }
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be a valid date.` };
    }
    return { ok: true, d };
};

const startOfDayUtc = (d) => {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
};

const endOfDayUtc = (d) => {
    const x = new Date(d);
    x.setUTCHours(23, 59, 59, 999);
    return x;
};

const resolveIsActiveFilter = (query) => {
    if (query.is_active !== undefined && query.is_active !== null && String(query.is_active).trim() !== '') {
        return parseBoolean(query.is_active);
    }
    if (query.status !== undefined && query.status !== null && String(query.status).trim() !== '') {
        const status = String(query.status).trim().toLowerCase();
        if (status === 'active') return true;
        if (status === 'inactive') return false;
    }
    return null;
};

const applyOfferDateFilters = (filter, query) => {
    const pStart = parseOptionalQueryDate(query.start_date, 'start_date');
    if (!pStart.ok) return { ok: false, message: pStart.message };

    const pEnd = parseOptionalQueryDate(query.end_date, 'end_date');
    if (!pEnd.ok) return { ok: false, message: pEnd.message };

    if (pStart.d && pEnd.d && startOfDayUtc(pStart.d) > endOfDayUtc(pEnd.d)) {
        return { ok: false, message: 'Start date must be on or before end date.' };
    }

    if (pStart.d && !pEnd.d) {
        filter.start_date = { $gte: startOfDayUtc(pStart.d) };
    } else if (!pStart.d && pEnd.d) {
        filter.end_date = { $lte: endOfDayUtc(pEnd.d) };
    } else if (pStart.d && pEnd.d) {
        filter.start_date = { $gte: startOfDayUtc(pStart.d) };
        filter.end_date = { $lte: endOfDayUtc(pEnd.d) };
    }

    return { ok: true };
};

const listOffers = async (query) => {
    try {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const filter = {
            deleted_at: null,
        };

        const isActiveFilter = resolveIsActiveFilter(query);
        if (isActiveFilter !== null) {
            filter.is_active = isActiveFilter;
        }

        const dateFilterResult = applyOfferDateFilters(filter, query);
        if (!dateFilterResult.ok) {
            return fail(400, dateFilterResult.message);
        }

        if (query.type && OFFER_TYPES.includes(String(query.type).trim().toLowerCase())) {
            filter.type = String(query.type).trim().toLowerCase();
        }

        if (query.name && String(query.name).trim()) {
            const searchTerm = escapeRegex(String(query.name).trim());
            filter.$or = [
                { name: { $regex: searchTerm, $options: 'i' } },
                { unique_id: { $regex: searchTerm, $options: 'i' } },
            ];
        }

        const sortByKey = query.sort_by ? String(query.sort_by).trim().toLowerCase() : '';
        const sortOrder = query.sort_order === 'asc' ? 1 : -1;
        const sortField = ALLOWED_SORT_FIELDS[sortByKey] || 'created_at';
        const sort = { [sortField]: sortOrder };

        const { data: rows, totalCount, totalPages, currentPage } = await applyPagination(
            Offer,
            filter,
            page,
            limit,
            sort
        );

        return ok(200, {
            message: 'Offer list fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage,
            records: rows,
        });
    } catch (err) {
        console.log('listOffers', err.message);
        return fail(500, 'Internal server error.');
    }
};

const createOffer = async (body) => {
    try {
        const {
            name,
            value,
            admin_contribution,
            partner_contribution,
            start_date,
            end_date,
            is_active,
        } = body;
        const type = String(body.type).trim().toLowerCase();

        const existing = await findOfferByNameInsensitive(name);
        if (existing) {
            return fail(409, 'An offer with this name already exists.');
        }

        const pValue = parseNumberField(value, 'value');
        if (!pValue.ok) return fail(400, pValue.message);

        const pAdmin = parseNumberField(admin_contribution, 'admin_contribution');
        if (!pAdmin.ok) return fail(400, pAdmin.message);

        const pPartner = parseNumberField(partner_contribution, 'partner_contribution');
        if (!pPartner.ok) return fail(400, pPartner.message);

        const pStart = parseDateField(start_date, 'start_date');
        if (!pStart.ok) return fail(400, pStart.message);

        const pEnd = parseDateField(end_date, 'end_date');
        if (!pEnd.ok) return fail(400, pEnd.message);

        const dateRangeError = validateDateRange(pStart.d, pEnd.d);
        if (dateRangeError) return fail(400, dateRangeError);

        const unique_id = await getOfferId();
        if (!unique_id || !String(unique_id).trim()) {
            return fail(500, 'Failed to generate offer unique id.');
        }

        const doc = new Offer({
            unique_id: String(unique_id).trim(),
            name: String(name).trim(),
            type,
            value: pValue.n,
            admin_contribution: pAdmin.n,
            partner_contribution: pPartner.n,
            start_date: pStart.d,
            end_date: pEnd.d,
            is_active,
        });

        const saved = await doc.save();
        const record = typeof saved.toObject === 'function' ? saved.toObject() : saved;
        return ok(200, { message: 'Offer created successfully.', record });
    } catch (error) {
        const validationMessage = formatValidationError(error);
        if (validationMessage) return fail(400, validationMessage);
        console.error('createOffer', error.message);
        return fail(500, 'Internal server error.');
    }
};

const updateOffer = async (id, body) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const offer = await Offer.findOne({ _id: pId.oid, deleted_at: null });
        if (!offer) return fail(404, 'No record found');

        if (body.name !== undefined) {
            const nextName = String(body.name).trim();
            const existing = await findOfferByNameInsensitive(nextName, offer._id);
            if (existing) {
                return fail(409, 'An offer with this name already exists.');
            }
            offer.name = nextName;
        }

        if (body.type !== undefined) {
            offer.type = String(body.type).trim().toLowerCase();
        }

        if (body.value !== undefined) {
            const pValue = parseNumberField(body.value, 'value');
            if (!pValue.ok) return fail(400, pValue.message);
            offer.value = pValue.n;
        }

        if (body.admin_contribution !== undefined) {
            
            const pAdmin = parseNumberField(body.admin_contribution, 'admin_contribution');
            if (!pAdmin.ok) return fail(400, pAdmin.message);
            offer.admin_contribution = pAdmin.n;
        }

        if (body.partner_contribution !== undefined) {
            const pPartner = parseNumberField(body.partner_contribution, 'partner_contribution');
            if (!pPartner.ok) return fail(400, pPartner.message);
            offer.partner_contribution = pPartner.n;
        }

        if (body.start_date !== undefined) {
            const pStart = parseDateField(body.start_date, 'start_date');
            if (!pStart.ok) return fail(400, pStart.message);
            offer.start_date = pStart.d;
        }

        if (body.end_date !== undefined) {
            const pEnd = parseDateField(body.end_date, 'end_date');
            if (!pEnd.ok) return fail(400, pEnd.message);
            offer.end_date = pEnd.d;
        }

        const dateRangeError = validateDateRange(offer.start_date, offer.end_date);
        if (dateRangeError) return fail(400, dateRangeError);

        if (body.is_active !== undefined) {
            offer.is_active = body.is_active;
        }

        offer.updated_at = new Date();
        const updated = await offer.save();
        return ok(200, { message: 'Offer updated successfully', record: updated });
    } catch (error) {
        const validationMessage = formatValidationError(error);
        if (validationMessage) return fail(400, validationMessage);
        console.error('updateOffer', error.message);
        return fail(500, 'Internal server error.');
    }
};

const getOfferById = async (id) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const record = await Offer.findOne({ _id: pId.oid, deleted_at: null });
        if (!record) return fail(404, 'No record found');
        return ok(200, { message: 'Offer fetched successfully', record });
    } catch (error) {
        console.error('getOfferById', error);
        return fail(500, 'Internal server error.');
    }
};

const softDeleteOffer = async (id) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const row = await Offer.findOne({ _id: pId.oid, deleted_at: null });
        if (!row) return fail(404, 'No record found');
        if (row.deleted_at) return fail(400, 'Offer is already deleted');

        row.deleted_at = new Date();
        row.updated_at = new Date();
        await row.save();
        return ok(200, { message: 'Offer deleted successfully' });
    } catch (error) {
        console.error('softDeleteOffer', error);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    listOffers,
    createOffer,
    updateOffer,
    getOfferById,
    softDeleteOffer,
};
