const mongoose = require('mongoose');
const User = require('../../../models/user');
const PartnerWalletLedger = require('../../../models/partner_wallet_ledger');
const { TRANSACTION_TYPES } = require('../../../models/partner_wallet_ledger');
const { getWalletAggregatesForPartners } = require('../../partner_payout_service');
const { sanitizeInput } = require('../../../validator/search_keyword_validator');

const USER_TYPE_PARTNER = 2;
const MAX_PAGE_SIZE = 100;

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

const formatDateOnly = (date) => {
    if (!date) return null;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
};

const parsePagination = (query, defaultLimit = 10) => {
    let page = parseInt(query.page, 10);
    let limit = parseInt(query.limit, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
    if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;
    return { page, limit, skip: (page - 1) * limit };
};

const parseDate = (value, fieldName) => {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: undefined };
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        return { ok: false, message: `${fieldName} must be a valid date.` };
    }
    return { ok: true, value: d };
};

const buildLedgerDateFilter = (query) => {
    if (!query.from_date && !query.to_date) {
        return { ok: true, filter: {} };
    }

    const filter = { date: {} };
    const fromParsed = parseDate(query.from_date, 'from_date');
    if (!fromParsed.ok) return fromParsed;
    const toParsed = parseDate(query.to_date, 'to_date');
    if (!toParsed.ok) return toParsed;

    if (fromParsed.value) filter.date.$gte = fromParsed.value;
    if (toParsed.value) {
        const end = new Date(toParsed.value);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
    }

    return { ok: true, filter };
};

const assertPartner = async (partnerId) => {
    if (!mongoose.Types.ObjectId.isValid(String(partnerId))) {
        return fail(401, 'Invalid token.');
    }

    const partnerOid = new mongoose.Types.ObjectId(String(partnerId));
    const partner = await User.findOne({
        _id: partnerOid,
        type: USER_TYPE_PARTNER,
        deleted_at: null,
    })
        .select('_id name user_id')
        .lean();

    if (!partner) {
        return fail(404, 'Partner not found.');
    }

    return { ok: true, partner, partnerOid };
};

const buildLedgerBaseFilter = (partnerOid, query = {}) => {
    const dateResult = buildLedgerDateFilter(query);
    if (!dateResult.ok) {
        return dateResult;
    }

    const ledgerFilter = {
        partner_id: partnerOid,
        deleted_at: null,
        ...dateResult.filter,
    };

    if (query.transaction_type) {
        const tt = String(query.transaction_type).trim().toLowerCase();
        if (!TRANSACTION_TYPES.includes(tt)) {
            return {
                ok: false,
                message: `transaction_type must be one of: ${TRANSACTION_TYPES.join(', ')}.`,
            };
        }
        ledgerFilter.transaction_type = tt;
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

    return { ok: true, ledgerFilter };
};

const computeLedgerPeriodTotals = async (ledgerFilter) => {
    const rows = await PartnerWalletLedger.aggregate([
        { $match: ledgerFilter },
        {
            $group: {
                _id: null,
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
                transaction_count: { $sum: 1 },
            },
        },
    ]);

    const row = rows[0] || {};
    const totalCredit = roundAmount(row.total_credit);
    const totalDebit = roundAmount(row.total_debit);

    return {
        transaction_count: row.transaction_count || 0,
        total_credit: totalCredit,
        total_debit: totalDebit,
        net_change: roundAmount(totalCredit - totalDebit),
    };
};

const formatLedgerRecord = (row) => ({
    _id: row._id,
    date: formatDateOnly(row.date),
    transaction_type: row.transaction_type,
    order_id: row.order_id || null,
    order_unique_id: row.order_unique_id || null,
    order_payment_id: row.order_payment_id || null,
    description: row.description,
    payment_method: row.payment_method || null,
    amount: row.amount,
});

const getWalletSummary = async (partnerId, query = {}) => {
    try {
        const partnerResult = await assertPartner(partnerId);
        if (!partnerResult.ok) {
            return partnerResult;
        }

        const { partner, partnerOid } = partnerResult;
        const walletMap = await getWalletAggregatesForPartners([partnerOid]);
        const wallet = walletMap.get(partnerOid.toString()) || { total_wallet_amount: 0 };

        const filterResult = buildLedgerBaseFilter(partnerOid, query);
        if (!filterResult.ok) {
            return fail(400, filterResult.message);
        }

        const periodTotals = await computeLedgerPeriodTotals(filterResult.ledgerFilter);

        return ok(200, {
            message: 'Partner wallet fetched successfully.',
            data: {
                wallet_balance: wallet.total_wallet_amount,
                partner: {
                    partner_id: partner.user_id || null,
                    partner_name: partner.name || '',
                },
                totals: periodTotals,
            },
        });
    } catch (err) {
        console.error('getWalletSummary', err.message);
        return fail(500, 'Internal server error.');
    }
};

const listWalletTransactions = async (partnerId, query = {}) => {
    try {
        const partnerResult = await assertPartner(partnerId);
        if (!partnerResult.ok) {
            return partnerResult;
        }

        const { partner, partnerOid } = partnerResult;
        const { page, limit, skip } = parsePagination(query);

        const filterResult = buildLedgerBaseFilter(partnerOid, query);
        if (!filterResult.ok) {
            return fail(400, filterResult.message);
        }

        const ledgerFilter = filterResult.ledgerFilter;

        const [walletMap, totalItems, rows, totals] = await Promise.all([
            getWalletAggregatesForPartners([partnerOid]),
            PartnerWalletLedger.countDocuments(ledgerFilter),
            PartnerWalletLedger.find(ledgerFilter)
                .sort({ date: -1, created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            computeLedgerPeriodTotals(ledgerFilter),
        ]);

        const wallet = walletMap.get(partnerOid.toString()) || { total_wallet_amount: 0 };
        const totalPages = Math.ceil(totalItems / limit) || 0;

        return ok(200, {
            message: 'Partner wallet transactions fetched successfully.',
            data: {
                wallet_balance: wallet.total_wallet_amount,
                partner: {
                    partner_id: partner.user_id || null,
                    partner_name: partner.name || '',
                },
                totals,
                records: rows.map(formatLedgerRecord),
                totalPages,
                totalItems,
                currentPage: page,
                limit,
            },
        });
    } catch (err) {
        console.error('listWalletTransactions', err.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    getWalletSummary,
    listWalletTransactions,
};
