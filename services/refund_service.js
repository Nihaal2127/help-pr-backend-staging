const mongoose = require('mongoose');
const Order = require('../models/order');
const OrderPayment = require('../models/order_payment');
const OrderRefund = require('../models/order_refund');
const User = require('../models/user');
const PartnerWalletLedger = require('../models/partner_wallet_ledger');
const {
    computeCustomerPaymentStatus,
    PAYMENT_STATUS_TOLERANCE,
} = require('../enum/order_payment_status_enum');
const { syncOrderPaymentStatus } = require('./order_payment_status_service');
const {
    syncCreditsFromFinancialOrders,
    getWalletAggregatesForPartners,
} = require('./partner_payout_service');
const { sanitizeInput } = require('../validator/search_keyword_validator');

const MAX_PAGE_SIZE = 100;
const LIST_SORT_FIELDS = ['order_id', 'user_name', 'refund_date', 'refund_amount'];
const ELIGIBLE_SORT_FIELDS = ['order_id', 'user_name', 'total_amount', 'user_paid'];

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

/** Main service admin commission + commission on additional charges. */
const getOrderAdminCommissionCap = (order) =>
    roundAmount(
        (Number(order?.admin_commission ?? order?.commission_amount) || 0) +
            (Number(order?.additional_charges_commission) || 0)
    );

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
        return { ok: false, message: `${fieldName} must be a valid date.` };
    }
    return { ok: true, value: d };
};

const formatDateOnly = (date) => {
    if (!date) return null;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
};

const buildRefundDateFilter = (query) => {
    const filter = {};
    const fromParsed = parseDate(query.from_date, 'from_date');
    if (!fromParsed.ok) return { error: fromParsed.message };
    const toParsed = parseDate(query.to_date, 'to_date');
    if (!toParsed.ok) return { error: toParsed.message };

    if (fromParsed.value || toParsed.value) {
        filter.refund_date = {};
        if (fromParsed.value) filter.refund_date.$gte = fromParsed.value;
        if (toParsed.value) {
            const end = new Date(toParsed.value);
            end.setHours(23, 59, 59, 999);
            filter.refund_date.$lte = end;
        }
    }
    return { filter };
};

const mapRefundRecord = (row) => ({
    _id: row._id,
    order_id: row.order_unique_id || row.order_id?.toString?.() || row.order_id,
    order_mongo_id: row.order_id,
    user_id: row.user_id || null,
    partner_id: row.partner_id || null,
    user_name: row.user_name,
    total_amount: row.total_amount,
    user_paid: row.user_paid,
    refund_amount: row.refund_amount,
    from_admin_commission: row.from_admin_commission,
    from_partner_wallet: row.from_partner_wallet,
    date: formatDateOnly(row.refund_date),
    refund_date: row.refund_date,
    franchise_id: row.franchise_id || null,
    notes: row.notes || '',
    created_at: row.created_at,
});

const resolveCustomerFromOrder = async (order) => {
    if (!order.user_id) {
        return { ok: false, message: 'Order has no customer (user_id).' };
    }
    const customer = await User.findOne({
        _id: order.user_id,
        deleted_at: null,
    })
        .select('name')
        .lean();
    const userName = (customer?.name || '').trim();
    if (!userName) {
        return { ok: false, message: 'Customer name could not be resolved for this order.' };
    }
    return { ok: true, user_id: order.user_id, user_name: userName };
};

const getOrderPaymentBreakdown = async (orderId) => {
    const payments = await OrderPayment.find({
        order_id: orderId,
        payer_type: 'customer',
        deleted_at: null,
    }).lean();
    return payments;
};

const getRefundableAmountForOrder = async (order) => {
    const payments = await getOrderPaymentBreakdown(order._id);
    const breakdown = computeCustomerPaymentStatus(
        Number(order.total_price) || 0,
        payments
    );
    return {
        breakdown,
        refundable_amount: breakdown.customer_net_paid,
    };
};

const getPartnerWalletBalance = async (partnerId) => {
    if (!partnerId) return 0;
    await syncCreditsFromFinancialOrders([partnerId]);
    const walletMap = await getWalletAggregatesForPartners([partnerId]);
    const wallet = walletMap.get(partnerId.toString());
    return wallet ? wallet.payable_balance : 0;
};

const listRefunds = async (query, scopeFilter = {}) => {
    try {
        const { page, limit, skip } = parsePagination(query);
        const filter = { deleted_at: null, ...scopeFilter };

        const dateFilter = buildRefundDateFilter(query);
        if (dateFilter.error) return fail(400, dateFilter.error);
        Object.assign(filter, dateFilter.filter);

        const orderIdSearch = query.order_id ?? query.orderId;
        if (orderIdSearch !== undefined && orderIdSearch !== null) {
            const s = String(orderIdSearch).trim();
            if (s) {
                const pattern = new RegExp(sanitizeInput(s), 'i');
                const orClauses = [{ order_unique_id: { $regex: pattern } }];
                const oidParsed = parseObjectId(s, 'order_id');
                if (oidParsed.ok) {
                    orClauses.push({ order_id: oidParsed.oid });
                }
                filter.$or = orClauses;
            }
        }

        const userNameSearch = query.user_name ?? query.userName ?? query['user-name'];
        if (userNameSearch !== undefined && userNameSearch !== null) {
            const s = String(userNameSearch).trim();
            if (s) {
                filter.user_name = { $regex: new RegExp(sanitizeInput(s), 'i') };
            }
        }

        const sortByRaw = query.sort_by ?? query.sortBy;
        const orderRaw = String(query.sort_order ?? query.sortOrder ?? 'desc').toLowerCase();
        const direction = orderRaw === 'asc' ? 1 : -1;
        const sortField = LIST_SORT_FIELDS.includes(sortByRaw) ? sortByRaw : 'refund_date';
        const sortKey = sortField === 'order_id' ? 'order_unique_id' : sortField;

        const [totalItems, rows] = await Promise.all([
            OrderRefund.countDocuments(filter),
            OrderRefund.find(filter)
                .sort({ [sortKey]: direction, created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
        ]);

        const totalPages = Math.ceil(totalItems / limit) || 0;

        return ok(200, {
            message: 'Records fetched successfully',
            data: {
                records: rows.map(mapRefundRecord),
                totalPages,
                totalItems,
                currentPage: page,
                limit,
            },
        });
    } catch (err) {
        console.error('listRefunds', err.message);
        return fail(500, 'Internal server error.');
    }
};

const listEligibleOrders = async (query, scopeFilter = {}) => {
    try {
        const { page, limit, skip } = parsePagination(query);

        const orderMatch = { deleted_at: null };
        if (scopeFilter.franchise_id !== undefined) {
            orderMatch.franchise_id = scopeFilter.franchise_id;
        }

        const ordersColl = Order.collection.name;
        const usersColl = User.collection.name;

        const pipeline = [
            {
                $match: {
                    deleted_at: null,
                    payer_type: 'customer',
                    status: { $in: ['completed', 'refunded'] },
                },
            },
            {
                $group: {
                    _id: '$order_id',
                    completed_sum: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0],
                        },
                    },
                    refunded_sum: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'refunded'] }, '$amount', 0],
                        },
                    },
                },
            },
            {
                $addFields: {
                    refundable_amount: { $subtract: ['$completed_sum', '$refunded_sum'] },
                },
            },
            {
                $match: {
                    completed_sum: { $gt: PAYMENT_STATUS_TOLERANCE },
                    refundable_amount: { $gt: PAYMENT_STATUS_TOLERANCE },
                },
            },
            {
                $lookup: {
                    from: ordersColl,
                    localField: '_id',
                    foreignField: '_id',
                    as: 'order',
                },
            },
            { $unwind: '$order' },
            { $match: { 'order.deleted_at': null, ...orderMatch } },
            {
                $lookup: {
                    from: usersColl,
                    localField: 'order.user_id',
                    foreignField: '_id',
                    as: 'customer',
                },
            },
            {
                $addFields: {
                    user_name: {
                        $ifNull: [{ $arrayElemAt: ['$customer.name', 0] }, ''],
                    },
                },
            },
        ];

        const orderIdSearch = query.order_id ?? query.orderId;
        if (orderIdSearch !== undefined && orderIdSearch !== null) {
            const s = String(orderIdSearch).trim();
            if (s) {
                const pattern = sanitizeInput(s);
                const searchMatch = {
                    $or: [
                        { 'order.unique_id': { $regex: pattern, $options: 'i' } },
                    ],
                };
                const oidParsed = parseObjectId(s, 'order_id');
                if (oidParsed.ok) {
                    searchMatch.$or.push({ _id: oidParsed.oid });
                }
                pipeline.push({ $match: searchMatch });
            }
        }

        const userNameSearch = query.user_name ?? query.userName ?? query['user-name'];
        if (userNameSearch !== undefined && userNameSearch !== null) {
            const s = String(userNameSearch).trim();
            if (s) {
                pipeline.push({
                    $match: {
                        user_name: { $regex: sanitizeInput(s), $options: 'i' },
                    },
                });
            }
        }

        const sortByRaw = query.sort_by ?? query.sortBy;
        const orderRaw = String(query.sort_order ?? query.sortOrder ?? 'asc').toLowerCase();
        const direction = orderRaw === 'desc' ? -1 : 1;
        const sortField = ELIGIBLE_SORT_FIELDS.includes(sortByRaw) ? sortByRaw : 'order_id';

        const sortStage = {};
        if (sortField === 'order_id') sortStage['order.unique_id'] = direction;
        else if (sortField === 'user_name') sortStage.user_name = direction;
        else if (sortField === 'total_amount') sortStage['order.total_price'] = direction;
        else if (sortField === 'user_paid') sortStage.refundable_amount = direction;

        pipeline.push({ $sort: sortStage });

        const countPipeline = [...pipeline, { $count: 'total' }];
        const dataPipeline = [
            ...pipeline,
            { $skip: skip },
            { $limit: limit },
            {
                $project: {
                    _id: '$order._id',
                    order_id: '$order.unique_id',
                    user_name: 1,
                    total_amount: '$order.total_price',
                    user_paid: '$refundable_amount',
                    refundable_amount: 1,
                    completed_sum: 1,
                    refunded_sum: 1,
                    admin_commission: '$order.admin_commission',
                    additional_charges_commission: '$order.additional_charges_commission',
                    partner_id: '$order.partner_id',
                    franchise_id: '$order.franchise_id',
                    payment_status: '$order.payment_status',
                },
            },
        ];

        const [countResult, rows] = await Promise.all([
            OrderPayment.aggregate(countPipeline),
            OrderPayment.aggregate(dataPipeline),
        ]);

        const totalItems = countResult[0]?.total || 0;
        const totalPages = Math.ceil(totalItems / limit) || 0;

        const records = await Promise.all(
            rows.map(async (row) => {
                let partner_wallet_balance = 0;
                if (row.partner_id) {
                    partner_wallet_balance = await getPartnerWalletBalance(row.partner_id);
                }
                return {
                    _id: row._id,
                    order_id: row.order_id || null,
                    user_name: row.user_name || '',
                    total_amount: roundAmount(row.total_amount),
                    user_paid: roundAmount(row.user_paid),
                    refundable_amount: roundAmount(row.refundable_amount),
                    admin_commission: getOrderAdminCommissionCap({
                        admin_commission: row.admin_commission,
                        additional_charges_commission: row.additional_charges_commission,
                    }),
                    partner_wallet_balance: roundAmount(partner_wallet_balance),
                    payment_status: row.payment_status,
                    franchise_id: row.franchise_id || null,
                };
            })
        );

        return ok(200, {
            message: 'Eligible orders fetched successfully',
            data: {
                records,
                totalPages,
                totalItems,
                currentPage: page,
                limit,
            },
        });
    } catch (err) {
        console.error('listEligibleOrders', err.message);
        return fail(500, 'Internal server error.');
    }
};

const getRefundById = async (refundId) => {
    try {
        const parsed = parseObjectId(refundId, 'id');
        if (!parsed.ok) return fail(400, parsed.message);

        const row = await OrderRefund.findOne({
            _id: parsed.oid,
            deleted_at: null,
        }).lean();

        if (!row) return fail(404, 'Refund not found.');

        return ok(200, {
            message: 'Record fetched successfully',
            data: mapRefundRecord(row),
        });
    } catch (err) {
        console.error('getRefundById', err.message);
        return fail(500, 'Internal server error.');
    }
};

const createRefund = async (body, createdById = null) => {
    try {
        const pOrder = parseObjectId(body.order_id, 'order_id');
        if (!pOrder.ok) return fail(400, pOrder.message);

        const refundAmount = roundAmount(body.refund_amount);
        if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
            return fail(400, 'refund_amount must be a positive number.');
        }

        const fromAdminCommission = roundAmount(body.from_admin_commission ?? 0);
        const fromPartnerWallet = roundAmount(body.from_partner_wallet ?? 0);

        if (fromAdminCommission < 0 || fromPartnerWallet < 0) {
            return fail(400, 'from_admin_commission and from_partner_wallet must be non-negative.');
        }

        const splitTotal = roundAmount(fromAdminCommission + fromPartnerWallet);
        if (Math.abs(splitTotal - refundAmount) > PAYMENT_STATUS_TOLERANCE) {
            return fail(
                400,
                'from_admin_commission + from_partner_wallet must equal refund_amount.'
            );
        }

        const dateParsed = parseDate(body.date ?? body.refund_date, 'date');
        if (!dateParsed.ok) return fail(400, dateParsed.message);
        if (!dateParsed.value) {
            return fail(400, 'date is required.');
        }

        const order = await Order.findOne({ _id: pOrder.oid, deleted_at: null }).lean();
        if (!order) return fail(404, 'Order not found.');

        const { breakdown, refundable_amount } = await getRefundableAmountForOrder(order);
        if (refundAmount > refundable_amount + PAYMENT_STATUS_TOLERANCE) {
            return fail(
                400,
                `refund_amount exceeds refundable balance (${roundAmount(refundable_amount)}).`
            );
        }

        const adminCommission = getOrderAdminCommissionCap(order);
        if (fromAdminCommission > adminCommission + PAYMENT_STATUS_TOLERANCE) {
            return fail(
                400,
                `from_admin_commission exceeds order admin commission (${adminCommission}).`
            );
        }

        if (fromPartnerWallet > 0) {
            if (!order.partner_id) {
                return fail(400, 'Order has no partner; from_partner_wallet must be 0.');
            }
            const walletBalance = await getPartnerWalletBalance(order.partner_id);
            if (fromPartnerWallet > walletBalance + PAYMENT_STATUS_TOLERANCE) {
                return fail(
                    400,
                    `from_partner_wallet exceeds partner wallet balance (${roundAmount(walletBalance)}).`
                );
            }
        }

        const customerResult = await resolveCustomerFromOrder(order);
        if (!customerResult.ok) return fail(400, customerResult.message);

        const totalAmount = roundAmount(order.total_price);
        const userPaid = roundAmount(breakdown.customer_paid_amount);
        const partnerId = order.partner_id || null;

        const now = new Date();

        const payment = await OrderPayment.create({
            order_id: order._id,
            payer_type: 'customer',
            amount: refundAmount,
            payment_method: body.payment_method || 'refund',
            status: 'refunded',
            transaction_reference: body.transaction_reference || '',
            paid_at: dateParsed.value,
            notes: body.notes || `Refund recorded via refund API`,
            created_at: now,
            updated_at: now,
        });

        if (fromPartnerWallet > 0 && order.partner_id) {
            await PartnerWalletLedger.create({
                partner_id: order.partner_id,
                franchise_id: order.franchise_id || null,
                transaction_type: 'debit',
                amount: fromPartnerWallet,
                date: dateParsed.value,
                description: `Refund deduction for order ${order.unique_id || order._id}`,
                payment_method: null,
                order_id: order._id,
                order_unique_id: order.unique_id || null,
                financial_order_id: null,
                payout_id: null,
                created_at: now,
                updated_at: now,
            });
        }

        const refund = await OrderRefund.create({
            order_id: order._id,
            order_unique_id: order.unique_id || '',
            franchise_id: order.franchise_id || null,
            user_id: customerResult.user_id,
            user_name: customerResult.user_name,
            partner_id: partnerId,
            total_amount: totalAmount,
            user_paid: userPaid,
            refund_amount: refundAmount,
            from_admin_commission: fromAdminCommission,
            from_partner_wallet: fromPartnerWallet,
            refund_date: dateParsed.value,
            notes: body.notes || '',
            created_by_id: createdById || null,
            order_payment_id: payment._id,
            created_at: now,
            updated_at: now,
        });

        await syncOrderPaymentStatus(order._id);

        return ok(201, {
            message: 'Refund created successfully.',
            data: mapRefundRecord(refund.toObject()),
        });
    } catch (err) {
        console.error('createRefund', err.message);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    listRefunds,
    listEligibleOrders,
    getRefundById,
    createRefund,
};
