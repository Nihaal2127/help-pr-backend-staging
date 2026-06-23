const mongoose = require('mongoose');
const { fieldLabel } = require('../utils/field_labels');
const Order = require('../models/order');
const OrderService = require('../models/order_services');
const OrderPayment = require('../models/order_payment');
const OrderRefund = require('../models/order_refund');
const User = require('../models/user');
const PartnerWalletLedger = require('../models/partner_wallet_ledger');
const {
    computeCustomerPaymentStatus,
    PAYMENT_STATUS_TOLERANCE,
} = require('../enum/order_payment_status_enum');
const { syncOrderPaymentStatus } = require('./order_payment_status_service');
const { syncAllPartnerOrderPaymentsForOrder } = require('./partner_wallet_order_service');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const {
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_CANCELLED,
    ORDER_STATUS_REFUNDED,
    buildOrderStatusMatchValues,
    normalizeOrderStatus,
    touchOrderStatusInfo,
    clearPendingAmountsForTerminalOrder,
} = require('../enum/order_status_enum');
const { GATEWAY_PAYMENT_METHOD } = require('../src/modules/payments/constants/payment.constants');
const {
    getRazorpayRefundableBalanceForOrder,
    initiateRazorpayRefundsForOrder,
} = require('../src/modules/payments/services/orderRazorpayRefund.service');

/** Canonical + legacy numeric values for completed and cancelled (refund-eligible lifecycle). */
const ELIGIBLE_REFUND_ORDER_STATUS_VALUES = [
    ...new Set([
        ...(buildOrderStatusMatchValues(ORDER_STATUS_COMPLETED) || []),
        ...(buildOrderStatusMatchValues(ORDER_STATUS_CANCELLED) || []),
    ]),
];

const isOrderStatusEligibleForRefund = (orderStatus) => {
    const normalized = normalizeOrderStatus(orderStatus);
    return (
        normalized === ORDER_STATUS_COMPLETED || normalized === ORDER_STATUS_CANCELLED
    );
};

const buildEligibleOrderLookupMatch = (scopeFilter = {}) => {
    const match = {
        'order.deleted_at': null,
        'order.order_status': { $in: ELIGIBLE_REFUND_ORDER_STATUS_VALUES },
    };
    if (scopeFilter.franchise_id !== undefined) {
        match['order.franchise_id'] = scopeFilter.franchise_id;
    }
    return match;
};

const MAX_PAGE_SIZE = 100;
const LIST_SORT_FIELDS = ['order_id', 'user_name', 'refund_date', 'refund_amount'];
const ELIGIBLE_SORT_FIELDS = ['order_id', 'user_name', 'total_amount', 'user_paid'];

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

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
    refund_channel: row.refund_channel || 'manual',
    razorpay_refund_details: row.razorpay_refund_details || [],
    created_at: row.created_at,
});

const resolveCustomerFromOrder = async (order) => {
    if (!order.user_id) {
        return { ok: false, message: 'Order has no customer.' };
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

/** Net partner wallet credits for an order (credits − debits on ledger rows for that order). */
const getPartnerWalletNetByOrderIds = async (orderIds) => {
    if (!orderIds.length) return new Map();

    const rows = await PartnerWalletLedger.aggregate([
        {
            $match: {
                order_id: { $in: orderIds },
                deleted_at: null,
            },
        },
        {
            $group: {
                _id: '$order_id',
                credits: {
                    $sum: {
                        $cond: [{ $eq: ['$transaction_type', 'credit'] }, '$amount', 0],
                    },
                },
                debits: {
                    $sum: {
                        $cond: [{ $eq: ['$transaction_type', 'debit'] }, '$amount', 0],
                    },
                },
            },
        },
    ]);

    return new Map(
        rows.map((row) => [
            row._id.toString(),
            roundAmount(Math.max(0, row.credits - row.debits)),
        ])
    );
};

const getPartnerWalletNetForOrder = async (orderId) => {
    const map = await getPartnerWalletNetByOrderIds([orderId]);
    return map.get(orderId.toString()) ?? 0;
};

/**
 * Partner clawback on refund for one order — only wallet ledger net credited for this order_id.
 * Does not use global partner balance or theoretical order entitlement.
 */
const resolvePartnerRefundShare = (refundableAmount, ledgerNetForOrder = 0) => {
    const refundable = roundAmount(refundableAmount);
    if (refundable <= PAYMENT_STATUS_TOLERANCE) {
        return 0;
    }
    const partnerShare = roundAmount(Math.max(0, ledgerNetForOrder));
    return roundAmount(Math.min(partnerShare, refundable));
};

/** Settlement split for a refund: partner wallet clawback + admin remainder (incl. tax). */
const computeRefundSettlementAmounts = (refundableAmount, partnerShare) => {
    const refundable = roundAmount(refundableAmount);
    const partner = roundAmount(Math.min(partnerShare, refundable));
    const admin = roundAmount(Math.max(0, refundable - partner));
    return {
        partner_payable_amount: partner,
        admin_payable_amount: admin,
    };
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
            { $match: buildEligibleOrderLookupMatch(scopeFilter) },
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
                    partner_id: '$order.partner_id',
                    franchise_id: '$order.franchise_id',
                    payment_status: '$order.payment_status',
                    order_status: '$order.order_status',
                },
            },
        ];

        // Eligible only when order lifecycle is completed or cancelled, then customer net paid > 0.

        const [countResult, rows] = await Promise.all([
            OrderPayment.aggregate(countPipeline),
            OrderPayment.aggregate(dataPipeline),
        ]);

        const totalItems = countResult[0]?.total || 0;
        const totalPages = Math.ceil(totalItems / limit) || 0;

        const orderIds = rows.map((row) => row._id);
        const partnerLedgerNetMap = await getPartnerWalletNetByOrderIds(orderIds);

        const razorpayRefundableEntries = await Promise.all(
            orderIds.map(async (orderId) => [
                orderId.toString(),
                await getRazorpayRefundableBalanceForOrder(orderId),
            ])
        );
        const razorpayRefundableMap = new Map(razorpayRefundableEntries);

        const records = rows.map((row) => {
                const refundable = roundAmount(row.refundable_amount);
                const ledgerNet = partnerLedgerNetMap.get(row._id.toString()) ?? 0;
                const partnerShare = resolvePartnerRefundShare(refundable, ledgerNet);
                const settlement = computeRefundSettlementAmounts(refundable, partnerShare);
                const razorpayRefundable = razorpayRefundableMap.get(row._id.toString()) ?? 0;

                return {
                    _id: row._id,
                    order_id: row.order_id || null,
                    user_name: row.user_name || '',
                    total_amount: roundAmount(row.total_amount),
                    user_paid: refundable,
                    refundable_amount: refundable,
                    razorpay_refundable_amount: roundAmount(razorpayRefundable),
                    partner_payable_amount: settlement.partner_payable_amount,
                    admin_payable_amount: settlement.admin_payable_amount,
                    payment_status: row.payment_status,
                    order_status: row.order_status || null,
                    franchise_id: row.franchise_id || null,
                };
            });

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

/**
 * After a refund is recorded: set order lifecycle to refunded and align service lines.
 * Applies for partial or full customer refunds.
 */
const applyOrderRefundedStatus = async (orderId) => {
    const order = await Order.findOne({ _id: orderId, deleted_at: null });
    if (!order) return null;

    order.order_status = ORDER_STATUS_REFUNDED;
    touchOrderStatusInfo(order, ORDER_STATUS_REFUNDED);
    clearPendingAmountsForTerminalOrder(order);
    order.updated_at = new Date();
    await order.save();

    if (order.service_items?.length) {
        await OrderService.updateMany(
            {
                _id: { $in: order.service_items },
                service_status: { $nin: [ORDER_STATUS_CANCELLED, ORDER_STATUS_REFUNDED] },
            },
            { $set: { service_status: ORDER_STATUS_REFUNDED, updated_at: new Date() } }
        );
    }

    return order;
};

const parseRefundViaRazorpay = (body) => {
    if (body?.refund_via_razorpay === true || body?.refund_via_razorpay === 'true') {
        return true;
    }
    const channel = String(body?.refund_channel || '').trim().toLowerCase();
    return channel === 'razorpay';
};

const createRefund = async (body, createdById = null) => {
    try {
        const pOrder = parseObjectId(body.order_id, 'Order ID');
        if (!pOrder.ok) return fail(400, pOrder.message);

        const refundAmount = roundAmount(body.refund_amount);
        if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
            return fail(400, 'Refund amount must be a positive number.');
        }

        const fromAdminCommission = roundAmount(body.from_admin_commission ?? 0);
        const fromPartnerWallet = roundAmount(body.from_partner_wallet ?? 0);

        if (fromAdminCommission < 0 || fromPartnerWallet < 0) {
            return fail(400, 'Admin portion and partner wallet portion must be non-negative.');
        }

        const splitTotal = roundAmount(fromAdminCommission + fromPartnerWallet);
        if (Math.abs(splitTotal - refundAmount) > PAYMENT_STATUS_TOLERANCE) {
            return fail(
                400,
                'Admin portion and partner wallet portion must add up to the refund amount.'
            );
        }

        const dateParsed = parseDate(body.date ?? body.refund_date, 'Refund date');
        if (!dateParsed.ok) return fail(400, dateParsed.message);
        if (!dateParsed.value) {
            return fail(400, 'Refund date is required.');
        }

        const order = await Order.findOne({ _id: pOrder.oid, deleted_at: null }).lean();
        if (!order) return fail(404, 'Order not found.');

        if (!isOrderStatusEligibleForRefund(order.order_status)) {
            return fail(
                400,
                'Refunds are only allowed when order_status is completed or cancelled.'
            );
        }

        const { breakdown, refundable_amount } = await getRefundableAmountForOrder(order);
        if (refundAmount > refundable_amount + PAYMENT_STATUS_TOLERANCE) {
            return fail(
                400,
                `Refund amount exceeds refundable balance (${roundAmount(refundable_amount)}).`
            );
        }

        const partnerCreditedForOrder = await getPartnerWalletNetForOrder(order._id);
        const maxPartnerWalletForRefund = roundAmount(
            Math.min(partnerCreditedForOrder, refundAmount)
        );

        if (fromPartnerWallet > 0) {
            if (!order.partner_id) {
                return fail(400, 'Order has no partner; partner wallet portion must be 0.');
            }
            if (fromPartnerWallet > maxPartnerWalletForRefund + PAYMENT_STATUS_TOLERANCE) {
                return fail(
                    400,
                    `Partner wallet portion exceeds partner credits for this order (${roundAmount(partnerCreditedForOrder)}).`
                );
            }
        }

        const customerResult = await resolveCustomerFromOrder(order);
        if (!customerResult.ok) return fail(400, customerResult.message);

        const refundViaRazorpay = parseRefundViaRazorpay(body);
        let razorpayRefundResult = null;

        if (refundViaRazorpay) {
            const razorpayRefundable = await getRazorpayRefundableBalanceForOrder(order._id);
            if (refundAmount > razorpayRefundable + PAYMENT_STATUS_TOLERANCE) {
                return fail(
                    400,
                    `Refund amount exceeds Razorpay refundable balance (${roundAmount(razorpayRefundable)}).`
                );
            }

            razorpayRefundResult = await initiateRazorpayRefundsForOrder(order._id, refundAmount, {
                notes: body.notes || '',
            });

            if (!razorpayRefundResult.ok) {
                return fail(
                    razorpayRefundResult.status || 502,
                    razorpayRefundResult.message || 'Razorpay refund failed.',
                    razorpayRefundResult.partial_refunds
                        ? { partial_refunds: razorpayRefundResult.partial_refunds }
                        : {}
                );
            }
        }

        const totalAmount = roundAmount(order.total_price);
        const userPaid = roundAmount(breakdown.customer_paid_amount);
        const partnerId = order.partner_id || null;

        const now = new Date();

        const payment = await OrderPayment.create({
            order_id: order._id,
            payer_type: 'customer',
            amount: refundAmount,
            payment_method: refundViaRazorpay
                ? GATEWAY_PAYMENT_METHOD
                : String(body.payment_method || '').trim() || 'cash',
            status: 'refunded',
            transaction_reference:
                razorpayRefundResult?.transaction_reference ||
                body.transaction_reference ||
                '',
            paid_at: dateParsed.value,
            notes:
                body.notes ||
                (refundViaRazorpay ? 'Refund via Razorpay' : 'Refund recorded via refund API'),
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
            refund_channel: refundViaRazorpay ? 'razorpay' : 'manual',
            razorpay_refund_details: razorpayRefundResult?.refunds || [],
            created_at: now,
            updated_at: now,
        });

        await syncOrderPaymentStatus(order._id);
        await applyOrderRefundedStatus(order._id);
        await syncOrderPaymentStatus(order._id);
        await syncAllPartnerOrderPaymentsForOrder(order._id);

        return ok(201, {
            message: refundViaRazorpay
                ? 'Refund created and processed via Razorpay.'
                : 'Refund created successfully.',
            data: mapRefundRecord(refund.toObject()),
        });
    } catch (err) {
        console.error('createRefund', err.message);
        return fail(500, 'Internal server error.');
    }
};

const listRefundsForOrders = async (orderIds) => {
    if (!orderIds.length) return new Map();

    const rows = await OrderRefund.find({
        order_id: { $in: orderIds },
        deleted_at: null,
    })
        .sort({ refund_date: -1, created_at: -1 })
        .lean();

    const map = new Map();
    for (const row of rows) {
        const key = row.order_id.toString();
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(mapRefundRecord(row));
    }
    return map;
};

const buildRefundSummaryForOrder = async (order, refundRecords = [], ledgerNet = null) => {
    const refundable = roundAmount(Number(order?.customer_net_paid) || 0);
    const totalRefunded = roundAmount(
        Number(order?.customer_refunded_amount) ||
            (refundRecords || []).reduce((sum, row) => sum + (Number(row.refund_amount) || 0), 0)
    );

    const partnerShare = resolvePartnerRefundShare(refundable, ledgerNet);
    const settlement = computeRefundSettlementAmounts(refundable, partnerShare);

    return {
        refund_count: (refundRecords || []).length,
        total_refunded_amount: totalRefunded,
        refundable_amount: refundable,
        customer_paid_amount: roundAmount(Number(order?.customer_paid_amount) || 0),
        partner_payable_amount: settlement.partner_payable_amount,
        admin_payable_amount: settlement.admin_payable_amount,
        total_from_partner_wallet: roundAmount(
            (refundRecords || []).reduce(
                (sum, row) => sum + (Number(row.from_partner_wallet) || 0),
                0
            )
        ),
        total_from_admin_commission: roundAmount(
            (refundRecords || []).reduce(
                (sum, row) => sum + (Number(row.from_admin_commission) || 0),
                0
            )
        ),
    };
};

/**
 * Attach `refunds` (history) and optionally `refund_summary` (rollup + settlement preview) to order API records.
 * @param {object} [options]
 * @param {boolean} [options.includeRefundSummary=true] — set false for GET /api/order/get/:id
 */
const attachRefundsToOrderRecords = async (orders, options = {}) => {
    if (!Array.isArray(orders) || !orders.length) return orders;

    const includeRefundSummary = options.includeRefundSummary !== false;

    const orderIds = orders
        .map((order) => order._id)
        .filter((id) => id != null);

    if (!orderIds.length) return orders;

    const [refundsByOrder, ledgerNetMap] = await Promise.all([
        listRefundsForOrders(orderIds),
        includeRefundSummary ? getPartnerWalletNetByOrderIds(orderIds) : Promise.resolve(new Map()),
    ]);

    return Promise.all(
        orders.map(async (order) => {
            const key = order._id?.toString?.() ?? String(order._id);
            const refunds = refundsByOrder.get(key) || [];
            const enriched = { ...order, refunds };
            if (includeRefundSummary) {
                enriched.refund_summary = await buildRefundSummaryForOrder(
                    order,
                    refunds,
                    ledgerNetMap.get(key) ?? 0
                );
            }
            return enriched;
        })
    );
};

module.exports = {
    listRefunds,
    listEligibleOrders,
    getRefundById,
    createRefund,
    attachRefundsToOrderRecords,
    buildRefundSummaryForOrder,
};
