const mongoose = require('mongoose');
const { fieldLabel } = require('../utils/field_labels');
const User = require('../models/user');
const Franchise = require('../models/franchise');
const PartnerPayout = require('../models/partner_payout');
const PartnerWalletLedger = require('../models/partner_wallet_ledger');
const { PAYMENT_METHODS } = require('../models/partner_payout');
const { TRANSACTION_TYPES } = require('../models/partner_wallet_ledger');
const { safeNotifyWalletTransaction } = require('../src/modules/notifications/services/domainHooks');
const { sanitizeInput } = require('../validator/search_keyword_validator');

const PARTNER_USER_TYPE = 2;
const MAX_PAGE_SIZE = 100;
const MAX_PARTNERS_LIMIT = 250;
const LIST_COLLATION = { locale: 'en', strength: 2 };
const LIST_SORT_FIELDS = ['partner_name', 'total_wallet_amount', 'last_withdraw_date', 'wallet_status'];

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

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

const parseOptionalObjectId = (raw, fieldName) => {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return { ok: true, oid: null };
    }
    return parseObjectId(raw, fieldName);
};

const parsePagination = (query, defaultLimit = 10, maxLimit = MAX_PAGE_SIZE) => {
    let page = parseInt(query.page, 10);
    let limit = parseInt(query.limit, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
    if (limit > maxLimit) limit = maxLimit;
    return { page, limit, skip: (page - 1) * limit };
};

const parseDate = (value, fieldName) => {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: undefined };
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be a valid date.` };
    }
    return { ok: true, value: d };
};

const formatDateOnly = (date) => {
    if (!date) return null;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
};

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

const getWalletAggregatesForPartners = async (partnerIds) => {
    if (!partnerIds.length) return new Map();

    const [ledgerAgg, payoutAgg] = await Promise.all([
        PartnerWalletLedger.aggregate([
            {
                $match: {
                    partner_id: { $in: partnerIds },
                    deleted_at: null,
                },
            },
            {
                $group: {
                    _id: '$partner_id',
                    total_credit: {
                        $sum: {
                            $cond: [{ $eq: ['$transaction_type', 'credit'] }, '$amount', 0],
                        },
                    },
                    total_debit: {
                        $sum: {
                            $cond: [{ $eq: ['$transaction_type', 'debit'] }, '$amount', 0],
                        },
                    },
                },
            },
        ]),
        PartnerPayout.aggregate([
            {
                $match: {
                    partner_id: { $in: partnerIds },
                    deleted_at: null,
                },
            },
            { $sort: { created_at: -1 } },
            {
                $group: {
                    _id: '$partner_id',
                    last_withdraw_amount: { $first: '$pay_now_amount' },
                    last_withdraw_date: { $first: '$created_at' },
                },
            },
        ]),
    ]);

    const ledgerMap = new Map(
        ledgerAgg.map((row) => [
            row._id.toString(),
            {
                total_wallet_amount: roundAmount(row.total_credit - row.total_debit),
            },
        ])
    );
    const payoutMap = new Map(
        payoutAgg.map((row) => [
            row._id.toString(),
            {
                last_withdraw_amount: row.last_withdraw_amount,
                last_withdraw_date: row.last_withdraw_date,
            },
        ])
    );

    const result = new Map();
    for (const id of partnerIds) {
        const key = id.toString();
        const ledger = ledgerMap.get(key) || { total_wallet_amount: 0 };
        const payout = payoutMap.get(key) || {};
        const total = ledger.total_wallet_amount;
        result.set(key, {
            total_wallet_amount: total,
            last_withdraw_amount: payout.last_withdraw_amount ?? null,
            last_withdraw_date: payout.last_withdraw_date ?? null,
            wallet_status: total > 0 ? 'pending' : 'paid',
            payable_balance: total > 0 ? total : 0,
        });
    }
    return result;
};

const buildPartnerBaseFilter = (query, scopeFilter = {}) => {
    const filter = { type: PARTNER_USER_TYPE, deleted_at: null };

    if (scopeFilter.franchise_id !== undefined) {
        filter.franchise_id = scopeFilter.franchise_id;
    } else if (query.franchise_id) {
        const p = parseObjectId(query.franchise_id, 'franchise_id');
        if (!p.ok) return { error: p.message };
        filter.franchise_id = p.oid;
    }

    const searchRaw = query.search ?? query.keyword;
    if (searchRaw !== undefined && searchRaw !== null) {
        const s = String(Array.isArray(searchRaw) ? searchRaw[0] : searchRaw).trim();
        if (s) {
            const pattern = new RegExp(sanitizeInput(s), 'i');
            filter.$or = [{ name: { $regex: pattern } }, { user_id: { $regex: pattern } }];
        }
    }

    return { filter };
};

const listPartnerPayouts = async (query, scopeFilter = {}) => {
    try {
        const { page, limit, skip } = parsePagination(query);
        const base = buildPartnerBaseFilter(query, scopeFilter);
        if (base.error) return fail(400, base.error);

        const partners = await User.find(base.filter)
            .select('_id name user_id franchise_id')
            .lean();

        if (!partners.length) {
            return ok(200, {
                message: 'Records fetched successfully',
                data: {
                    records: [],
                    totalPages: 0,
                    totalItems: 0,
                    currentPage: page,
                    limit,
                },
            });
        }

        const partnerIds = partners.map((p) => p._id);
        const walletMap = await getWalletAggregatesForPartners(partnerIds);

        let rows = partners.map((p) => {
            const wallet = walletMap.get(p._id.toString()) || {
                total_wallet_amount: 0,
                last_withdraw_amount: null,
                last_withdraw_date: null,
                wallet_status: 'paid',
            };
            return {
                _id: p._id,
                partner_id: p.user_id || null,
                partner_name: p.name || '',
                total_wallet_amount: wallet.total_wallet_amount,
                last_withdraw_amount: wallet.last_withdraw_amount,
                last_withdraw_date: formatDateOnly(wallet.last_withdraw_date),
                wallet_status: wallet.wallet_status,
            };
        });

        if (query.wallet_status) {
            const status = String(query.wallet_status).trim().toLowerCase();
            if (!['pending', 'paid'].includes(status)) {
                return fail(400, `${fieldLabel('wallet_status')} must be one of: pending, paid.`);
            }
            rows = rows.filter((r) => r.wallet_status === status);
        }

        if (query.from_date || query.to_date) {
            const fromParsed = parseDate(query.from_date, 'from_date');
            if (!fromParsed.ok) return fail(400, fromParsed.message);
            const toParsed = parseDate(query.to_date, 'to_date');
            if (!toParsed.ok) return fail(400, toParsed.message);

            rows = rows.filter((r) => {
                if (!r.last_withdraw_date) return false;
                const d = new Date(r.last_withdraw_date);
                if (fromParsed.value && d < fromParsed.value) return false;
                if (toParsed.value) {
                    const end = new Date(toParsed.value);
                    end.setHours(23, 59, 59, 999);
                    if (d > end) return false;
                }
                return true;
            });
        }

        const sortByRaw = query.sort_by ?? query.sortBy;
        const orderRaw = String(query.sort_order ?? query.sortOrder ?? 'asc').toLowerCase();
        const direction = orderRaw === 'desc' ? -1 : 1;
        const sortBy = LIST_SORT_FIELDS.includes(sortByRaw) ? sortByRaw : 'partner_name';

        rows.sort((a, b) => {
            let av = a[sortBy];
            let bv = b[sortBy];
            if (sortBy === 'last_withdraw_date') {
                av = av ? new Date(av).getTime() : 0;
                bv = bv ? new Date(bv).getTime() : 0;
            }
            if (typeof av === 'string') av = av.toLowerCase();
            if (typeof bv === 'string') bv = bv.toLowerCase();
            if (av < bv) return -1 * direction;
            if (av > bv) return 1 * direction;
            return 0;
        });

        const totalItems = rows.length;
        const totalPages = Math.ceil(totalItems / limit) || 0;
        const records = rows.slice(skip, skip + limit);

        return ok(200, {
            message: 'Records fetched successfully',
            data: {
                records,
                totalPages,
                totalItems,
                currentPage: page,
                limit,
            },
        });
    } catch (err) {
        console.error('listPartnerPayouts', err.message);
        return fail(500, 'Internal server error.');
    }
};

const listPartnersForDropdown = async (query, scopeFilter = {}) => {
    try {
        let limit = parseInt(query.limit, 10);
        if (!Number.isFinite(limit) || limit < 1) limit = MAX_PARTNERS_LIMIT;
        if (limit > MAX_PARTNERS_LIMIT) limit = MAX_PARTNERS_LIMIT;

        const base = buildPartnerBaseFilter(query, scopeFilter);
        if (base.error) return fail(400, base.error);

        const partners = await User.find(base.filter)
            .select('_id name user_id')
            .sort({ name: 1 })
            .limit(limit)
            .lean();

        if (!partners.length) {
            return ok(200, {
                data: { records: [], totalItems: 0 },
            });
        }

        const partnerIds = partners.map((p) => p._id);
        const walletMap = await getWalletAggregatesForPartners(partnerIds);

        const records = partners.map((p) => {
            const wallet = walletMap.get(p._id.toString()) || {
                total_wallet_amount: 0,
                payable_balance: 0,
            };
            return {
                _id: p._id,
                partner_id: p.user_id || null,
                partner_name: p.name || '',
                total_wallet_amount: wallet.total_wallet_amount,
                payable_balance: wallet.payable_balance,
            };
        });

        return ok(200, {
            data: {
                records,
                totalItems: records.length,
            },
        });
    } catch (err) {
        console.error('listPartnersForDropdown', err.message);
        return fail(500, 'Internal server error.');
    }
};

const createPartnerPayout = async (body) => {
    try {
        const pPartner = parseObjectId(body.partner_id, 'partner_id');
        if (!pPartner.ok) return fail(400, pPartner.message);
        const pFranchise = await parseOptionalObjectId(body.franchise_id, 'franchise_id');
        if (!pFranchise.ok) return fail(400, pFranchise.message);

        const amount = Number(body.pay_now_amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return fail(400, `${fieldLabel('pay_now_amount')} must be a positive number.`);
        }

        const paymentMethod = String(body.payment_method || '').trim().toLowerCase();
        if (!PAYMENT_METHODS.includes(paymentMethod)) {
            return fail(400, `${fieldLabel('payment_method')} must be one of: ${PAYMENT_METHODS.join(', ')}.`);
        }

        const description = String(body.description || '').trim();
        if (!description) {
            return fail(400, 'description is required.');
        }

        const partner = await User.findOne({
            _id: pPartner.oid,
            type: PARTNER_USER_TYPE,
            deleted_at: null,
        }).lean();
        if (!partner) return fail(404, 'Partner not found.');

        if (pFranchise.oid) {
            const franchise = await Franchise.findOne({
                _id: pFranchise.oid,
                deleted_at: null,
            }).lean();
            if (!franchise) return fail(404, 'Franchise not found.');
            if (
                partner.franchise_id &&
                partner.franchise_id.toString() !== pFranchise.oid.toString()
            ) {
                return fail(400, 'Partner does not belong to this franchise.');
            }
        }

        const walletMap = await getWalletAggregatesForPartners([pPartner.oid]);
        const wallet = walletMap.get(pPartner.oid.toString());
        const payable = wallet ? wallet.payable_balance : 0;

        if (amount > payable) {
            return fail(400, `${fieldLabel('pay_now_amount')} exceeds payable balance (${payable}).`);
        }

        const now = new Date();
        const payout = await PartnerPayout.create({
            partner_id: pPartner.oid,
            franchise_id: pFranchise.oid || partner.franchise_id || null,
            pay_now_amount: amount,
            payment_method: paymentMethod,
            description,
            wallet_status: 'completed',
            created_at: now,
            updated_at: now,
        });

        const ledgerEntry = await PartnerWalletLedger.create({
            partner_id: pPartner.oid,
            franchise_id: payout.franchise_id,
            transaction_type: 'debit',
            amount,
            date: now,
            description,
            payment_method: paymentMethod,
            order_id: null,
            order_unique_id: null,
            financial_order_id: null,
            payout_id: payout._id,
            created_at: now,
            updated_at: now,
        });

        void safeNotifyWalletTransaction({
            ledgerEntry,
            actorUserId: null,
        });

        return ok(201, {
            message: 'Partner payout created successfully.',
            data: {
                _id: payout._id,
                partner_id: partner.user_id || pPartner.oid.toString(),
                pay_now_amount: payout.pay_now_amount,
                payment_method: payout.payment_method,
                description: payout.description,
                franchise_id: payout.franchise_id,
                created_at: payout.created_at,
            },
        });
    } catch (err) {
        console.error('createPartnerPayout', err.message);
        return fail(500, 'Internal server error.');
    }
};

const getPartnerWalletLedger = async (query) => {
    try {
        const partnerIdRaw = query.id ?? query.partner_id;
        const pPartner = parseObjectId(partnerIdRaw, 'id');
        if (!pPartner.ok) return fail(400, pPartner.message);

        const { page, limit, skip } = parsePagination(query);

        const partner = await User.findOne({
            _id: pPartner.oid,
            type: PARTNER_USER_TYPE,
            deleted_at: null,
        })
            .select('_id name user_id')
            .lean();
        if (!partner) return fail(404, 'Partner not found.');

        const walletMap = await getWalletAggregatesForPartners([pPartner.oid]);
        const wallet = walletMap.get(pPartner.oid.toString()) || { total_wallet_amount: 0 };

        const ledgerFilter = {
            partner_id: pPartner.oid,
            deleted_at: null,
        };

        if (query.transaction_type) {
            const tt = String(query.transaction_type).trim().toLowerCase();
            if (!TRANSACTION_TYPES.includes(tt)) {
                return fail(400, `${fieldLabel('transaction_type')} must be one of: ${TRANSACTION_TYPES.join(', ')}.`);
            }
            ledgerFilter.transaction_type = tt;
        }

        if (query.from_date || query.to_date) {
            ledgerFilter.date = {};
            const fromParsed = parseDate(query.from_date, 'from_date');
            if (!fromParsed.ok) return fail(400, fromParsed.message);
            const toParsed = parseDate(query.to_date, 'to_date');
            if (!toParsed.ok) return fail(400, toParsed.message);
            if (fromParsed.value) ledgerFilter.date.$gte = fromParsed.value;
            if (toParsed.value) {
                const end = new Date(toParsed.value);
                end.setHours(23, 59, 59, 999);
                ledgerFilter.date.$lte = end;
            }
        }

        const searchRaw = query.search ?? query.keyword;
        if (searchRaw !== undefined && searchRaw !== null) {
            const s = String(Array.isArray(searchRaw) ? searchRaw[0] : searchRaw).trim();
            if (s) {
                const pattern = new RegExp(sanitizeInput(s), 'i');
                ledgerFilter.$or = [
                    { description: { $regex: pattern } },
                    { order_unique_id: { $regex: pattern } },
                    { payment_method: { $regex: pattern } },
                ];
            }
        }

        const [totalItems, rows] = await Promise.all([
            PartnerWalletLedger.countDocuments(ledgerFilter),
            PartnerWalletLedger.find(ledgerFilter)
                .sort({ date: -1, created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
        ]);

        const totalPages = Math.ceil(totalItems / limit) || 0;
        const records = rows.map((row) => ({
            _id: row._id,
            date: formatDateOnly(row.date),
            transaction_type: row.transaction_type,
            order_id: row.order_id || null,
            order_unique_id: row.order_unique_id || null,
            order_payment_id: row.order_payment_id || null,
            description: row.description,
            payment_method: row.payment_method || null,
            amount: row.amount,
        }));

        return ok(200, {
            data: {
                partner: {
                    partner_id: partner.user_id || null,
                    partner_name: partner.name || '',
                    total_wallet_amount: wallet.total_wallet_amount,
                },
                records,
                totalPages,
                totalItems,
                currentPage: page,
                limit,
            },
        });
    } catch (err) {
        console.error('getPartnerWalletLedger', err.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    listPartnerPayouts,
    listPartnersForDropdown,
    createPartnerPayout,
    getPartnerWalletLedger,
    getWalletAggregatesForPartners,
};
