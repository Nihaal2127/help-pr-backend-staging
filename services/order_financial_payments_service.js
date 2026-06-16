const mongoose = require('mongoose');
const Order = require('../models/order');
const OrderPayment = require('../models/order_payment');
const User = require('../models/user');
const Service = require('../models/service');
const { buildPartnerOrderSummaryFromOrderDoc } = require('../utils/partner_order_summary');
const {
    ORDER_STATUS_IN_PROGRESS,
    ORDER_STATUS_COMPLETED,
    buildOrderStatusQueryFilter,
    normalizeOrderStatus,
    isOrderStatusWithNoPendingAmounts,
    buildTerminalOrderStatusMatchValues,
} = require('../enum/order_status_enum');
const {
    isValidOrderPaymentStatus,
    isValidPartnerPaymentStatus,
    computePartnerPaymentStatus,
} = require('../enum/order_payment_status_enum');
const { syncOrderPaymentStatus } = require('./order_payment_status_service');
const { resolveOrderListScope, assertOrderRecordAccess } = require('../utils/order_access');
const { buildOrderDateRangeFilter } = require('../utils/schedule_date_filters');
const { resolveListSearchRegex } = require('../utils/list_query_helpers');
const { buildObjectIdQueryFilters } = require('../utils/mongoose_helpers');
const { parseFacetListResult, getListCollectionNames } = require('../utils/list_aggregation');

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const FINANCIAL_SORT_FIELDS = {
    user_name: '_user.name',
    partner_name: '_partner.name',
    service_name: '_service.name',
    service_date: 'service_date',
    created_at: 'created_at',
    order_date: 'order_date',
    total_price: 'total_price',
    order_unique_id: 'unique_id',
};

const LIST_COLLATION = { locale: 'en', strength: 2 };

/** Canonical + legacy numeric values for cancelled/refunded (financial pending = 0). */
const TERMINAL_ORDER_STATUS_MATCH_VALUES = buildTerminalOrderStatusMatchValues();

const roundMoney = (n) => Math.round(Number(n || 0) * 100) / 100;

const formatDateOnly = (date) => {
    if (!date) return null;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
};

/** Ignore legacy time-only placeholders (e.g. 2000-01-01 from service_from_time). */
const resolveServiceDateForFinancial = (row) => {
    const candidates = [row.service_date, row.order_date, row.created_at];
    for (const raw of candidates) {
        if (!raw) continue;
        const d = new Date(raw);
        if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2010) continue;
        return formatDateOnly(d);
    }
    return formatDateOnly(row.order_date) || formatDateOnly(row.created_at);
};

const resolvePartnerFinancialFields = (row, totalPartnerAmount) => {
    const customerNetPaid = roundMoney(row.customer_net_paid);
    const paidToPartner = roundMoney(row.partner_paid_amount);
    const syntheticPayments =
        paidToPartner > 0
            ? [{ payer_type: 'partner', amount: paidToPartner, status: 'completed' }]
            : [];

    const partnerBreakdown = computePartnerPaymentStatus(
        customerNetPaid,
        syntheticPayments,
        totalPartnerAmount
    );

    return {
        paid_to_partner: partnerBreakdown.partner_paid_amount,
        pending_to_partner: partnerBreakdown.partner_due_amount,
        partner_payment_status: partnerBreakdown.partner_payment_status,
    };
};

/** Financial UI uses in_progress; orders store in-progress. */
const toFinancialOrderStatus = (orderStatus) => {
    const s = String(orderStatus || '').toLowerCase();
    if (s === 'in-progress') return 'in_progress';
    return s;
};

const resolveFinancialListOrderStatusFilter = (orderStatusParam) => {
    if (orderStatusParam === undefined || orderStatusParam === null || String(orderStatusParam).trim() === '') {
        return { ok: true, filter: {} };
    }
    const raw = String(orderStatusParam).trim().toLowerCase();
    if (raw === 'in_progress' || raw === 'in-progress') {
        return { ok: true, filter: buildOrderStatusQueryFilter(ORDER_STATUS_IN_PROGRESS) };
    }
    if (raw === 'completed') {
        return { ok: true, filter: buildOrderStatusQueryFilter(ORDER_STATUS_COMPLETED) };
    }
    const normalized = normalizeOrderStatus(orderStatusParam);
    if (!normalized) {
        return {
            ok: false,
            message: 'Invalid order status. Use: in_progress, completed, in-progress, cancelled, refunded.',
        };
    }
    return { ok: true, filter: buildOrderStatusQueryFilter(normalized) };
};

const buildListSort = (query) => {
    const sortByRaw = query.sort_by ?? query.sortBy;
    const orderRaw = String(query.sort_order ?? query.sortOrder ?? '').toLowerCase();

    if (!sortByRaw) {
        return { sort: { created_at: -1 }, collation: LIST_COLLATION };
    }

    const key = String(sortByRaw);
    const sortField = FINANCIAL_SORT_FIELDS[key] || 'created_at';
    let direction = -1;
    if (orderRaw === 'asc' || orderRaw === '1') direction = 1;
    else if (orderRaw === 'desc' || orderRaw === '-1') direction = -1;
    else if (sortField === 'created_at') direction = -1;
    else direction = 1;

    const collation =
        sortField === '_user.name' ||
        sortField === '_partner.name' ||
        sortField === '_service.name' ||
        sortField === 'unique_id'
            ? LIST_COLLATION
            : undefined;

    return { sort: { [sortField]: direction }, collation };
};

const shapeFinancialOverviewRecord = (row, srNo) => {
    const partnerEarning = roundMoney(row._line_partner_earning);
    const additionalBase = roundMoney(row.additional_charges_subtotal);
    const totalPartnerAmount = roundMoney(partnerEarning + additionalBase);
    const partnerFinancial = resolvePartnerFinancialFields(row, totalPartnerAmount);
    const noPending = isOrderStatusWithNoPendingAmounts(row.order_status);

    return {
        sr_no: srNo,
        _id: row._id,
        order_unique_id: row.unique_id || '',
        order_id: row._id,
        franchise_id: row.franchise_id || null,
        user_id: row.user_id,
        user_name: row._user_name || '',
        partner_id: row.partner_id || null,
        partner_name: row._partner_name || '',
        service_name: row._service_name || '',
        service_date: resolveServiceDateForFinancial(row),
        total_amount: roundMoney(row.total_price),
        total_price: roundMoney(row.total_price),
        commission_percentage: roundMoney(row.commission_percent),
        commission_amount: roundMoney(row.commission_amount),
        tax_percentage: roundMoney(row.tax_percent),
        tax_amount: roundMoney(row.tax_amount),
        customer_paid_amount: roundMoney(row.customer_paid_amount),
        customer_pending_amount: noPending ? 0 : roundMoney(row.customer_due_amount),
        total_service_amount: roundMoney(row.sub_total ?? row.total_service_charge),
        total_partner_amount: totalPartnerAmount,
        paid_to_partner: partnerFinancial.paid_to_partner,
        pending_to_partner: noPending ? 0 : partnerFinancial.pending_to_partner,
        customer_payment_status: row.user_payment_status || row.payment_status || 'unpaid',
        partner_payment_status: partnerFinancial.partner_payment_status,
        order_status: toFinancialOrderStatus(row.order_status),
        order_status_canonical: row.order_status,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
};

const buildFinancialOverviewPipeline = ({
    baseFilter,
    searchRegex,
    sortStage,
    skip,
    limit,
    collections,
}) => {
    const searchMatch =
        searchRegex &&
        ({
            $or: [
                { unique_id: searchRegex },
                { '_user.name': searchRegex },
                { '_partner.name': searchRegex },
                { '_service.name': searchRegex },
            ],
        });

    const lookupLine = {
        $lookup: {
            from: collections.orderServices,
            let: { lineId: { $arrayElemAt: ['$service_items', 0] } },
            pipeline: [
                {
                    $match: {
                        $and: [
                            { $expr: { $eq: ['$_id', '$$lineId'] } },
                            { deleted_at: null },
                        ],
                    },
                },
                { $limit: 1 },
                {
                    $project: {
                        service_date: 1,
                        partner_earning: 1,
                    },
                },
            ],
            as: '_line',
        },
    };

    const stages = [
        { $match: baseFilter },
        { $lookup: { from: collections.users, localField: 'user_id', foreignField: '_id', as: '_user' } },
        { $lookup: { from: collections.users, localField: 'partner_id', foreignField: '_id', as: '_partner' } },
        { $lookup: { from: collections.services, localField: 'service_id', foreignField: '_id', as: '_service' } },
        lookupLine,
        { $unwind: { path: '$_user', preserveNullAndEmptyArrays: true } },
        { $unwind: { path: '$_partner', preserveNullAndEmptyArrays: true } },
        { $unwind: { path: '$_service', preserveNullAndEmptyArrays: true } },
        { $unwind: { path: '$_line', preserveNullAndEmptyArrays: true } },
        {
            $addFields: {
                _user_name: '$_user.name',
                _partner_name: '$_partner.name',
                _service_name: '$_service.name',
                _line_partner_earning: { $ifNull: ['$_line.partner_earning', 0] },
                service_date: {
                    $ifNull: ['$_line.service_date', '$order_date', '$created_at'],
                },
                order_date: 1,
            },
        },
    ];

    if (searchMatch) {
        stages.push({ $match: searchMatch });
    }

    stages.push(
        { $sort: sortStage },
        {
            $facet: {
                data: [{ $skip: skip }, { $limit: limit }],
                totalCount: [{ $count: 'totalCount' }],
            },
        }
    );

    return stages;
};

const buildPartnerPendingLookupStages = (orderServicesCollection) => [
    {
        $lookup: {
            from: orderServicesCollection,
            let: { lineId: { $arrayElemAt: ['$service_items', 0] } },
            pipeline: [
                {
                    $match: {
                        $and: [
                            { $expr: { $eq: ['$_id', '$$lineId'] } },
                            { deleted_at: null },
                        ],
                    },
                },
                { $limit: 1 },
                { $project: { partner_earning: 1 } },
            ],
            as: '_line',
        },
    },
    { $unwind: { path: '$_line', preserveNullAndEmptyArrays: true } },
    {
        $addFields: {
            _partner_entitlement: {
                $cond: [
                    {
                        $in: ['$order_status', TERMINAL_ORDER_STATUS_MATCH_VALUES],
                    },
                    0,
                    {
                        $add: [
                            { $ifNull: ['$_line.partner_earning', 0] },
                            { $ifNull: ['$additional_charges_subtotal', 0] },
                        ],
                    },
                ],
            },
        },
    },
    {
        $addFields: {
            _partner_pending: {
                $max: [
                    0,
                    {
                        $subtract: [
                            '$_partner_entitlement',
                            { $ifNull: ['$partner_paid_amount', 0] },
                        ],
                    },
                ],
            },
            _customer_pending: {
                $cond: [
                    { $in: ['$order_status', TERMINAL_ORDER_STATUS_MATCH_VALUES] },
                    0,
                    { $ifNull: ['$customer_due_amount', 0] },
                ],
            },
        },
    },
];

/**
 * Dashboard cards for Financial — Order Payments (derived from orders).
 */
const buildFinancialOrderPaymentsCountFromOrders = async (scopeFilter = {}) => {
    const match = { deleted_at: null, ...scopeFilter };
    const collections = getListCollectionNames({
        orderServices: require('../models/order_services'),
    });

    const result = await Order.aggregate([
        { $match: match },
        ...buildPartnerPendingLookupStages(collections.orderServices),
        {
            $group: {
                _id: null,
                total_completed_orders: {
                    $sum: {
                        $cond: [
                            {
                                $in: [
                                    '$order_status',
                                    [
                                        ORDER_STATUS_COMPLETED,
                                        'completed',
                                        3,
                                    ],
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
                total_in_progress_orders: {
                    $sum: {
                        $cond: [
                            {
                                $in: [
                                    '$order_status',
                                    [
                                        ORDER_STATUS_IN_PROGRESS,
                                        'in_progress',
                                        'in-progress',
                                        1,
                                        2,
                                    ],
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
                total_partner_pending_amount: { $sum: '$_partner_pending' },
                total_user_pending_amount: { $sum: '$_customer_pending' },
            },
        },
    ]);

    const row = result[0] || {};
    return {
        total_completed_orders: row.total_completed_orders || 0,
        total_in_progress_orders: row.total_in_progress_orders || 0,
        total_partner_pending_amount: roundMoney(row.total_partner_pending_amount),
        total_user_pending_amount: roundMoney(row.total_user_pending_amount),
    };
};

const listFinancialOrderPayments = async (req) => {
    try {
        const query = req.query || {};
        const scopeResult = await resolveOrderListScope(req, {
            franchiseIdFromQuery: query.franchise_id,
        });
        if (!scopeResult.ok) {
            return fail(scopeResult.status, scopeResult.message);
        }

        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const skip = (page - 1) * limit;

        const statusFilterResult = resolveFinancialListOrderStatusFilter(query.order_status);
        if (!statusFilterResult.ok) {
            return fail(400, statusFilterResult.message);
        }

        const paymentStatusRaw =
            query.customer_payment_status ??
            query.user_payment_status ??
            query.payment_status;
        if (paymentStatusRaw && !isValidOrderPaymentStatus(String(paymentStatusRaw).trim().toLowerCase())) {
            return fail(
                400,
                'Invalid customer_payment_status. Use: unpaid, paid, partially_paid, refund, partially_refund.'
            );
        }

        if (
            query.partner_payment_status &&
            !isValidPartnerPaymentStatus(String(query.partner_payment_status).trim().toLowerCase())
        ) {
            return fail(400, 'Invalid partner payment status. Use: unpaid, partially_paid, paid.');
        }

        const dateRangeResult = buildOrderDateRangeFilter(query);
        if (!dateRangeResult.ok) {
            return fail(400, dateRangeResult.message);
        }

        const baseFilter = {
            deleted_at: null,
            ...scopeResult.filter,
            ...dateRangeResult.filter,
            ...statusFilterResult.filter,
            ...buildObjectIdQueryFilters(query, ['user_id', 'partner_id', 'franchise_id', 'service_id']),
        };

        if (paymentStatusRaw) {
            const st = String(paymentStatusRaw).trim().toLowerCase();
            baseFilter.user_payment_status = st;
            baseFilter.payment_status = st;
        }
        if (query.partner_payment_status) {
            baseFilter.partner_payment_status = String(query.partner_payment_status).trim().toLowerCase();
        }

        const searchRegex = resolveListSearchRegex(req);
        const { sort: sortStage, collation } = buildListSort(query);
        const collections = getListCollectionNames({
            users: User,
            services: Service,
            orderServices: require('../models/order_services'),
        });

        const pipeline = buildFinancialOverviewPipeline({
            baseFilter,
            searchRegex,
            sortStage,
            skip,
            limit,
            collections,
        });

        let agg = Order.aggregate(pipeline);
        if (collation) {
            agg = agg.collation(collation);
        }
        const result = await agg.exec();
        const { data: rows, totalCount, totalPages } = parseFacetListResult(result, limit);

        const records = rows.map((row, index) =>
            shapeFinancialOverviewRecord(row, skip + index + 1)
        );

        return ok(200, {
            message: 'Financial order payments fetched successfully.',
            source: 'order',
            totalItems: totalCount,
            totalPages,
            currentPage: page,
            records,
        });
    } catch (err) {
        console.error('listFinancialOrderPayments', err);
        return fail(500, 'Internal server error.');
    }
};

const getFinancialOrderPaymentById = async (req, orderId) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return fail(400, 'Invalid order id.');
        }

        const order = await Order.findOne({ _id: orderId, deleted_at: null }).lean();
        if (!order) {
            return fail(404, 'Order not found.');
        }

        const access = await assertOrderRecordAccess(req, order);
        if (!access.ok) {
            return fail(access.status, access.message || 'Forbidden.');
        }

        await syncOrderPaymentStatus(order._id);

        const collections = getListCollectionNames({
            users: User,
            services: Service,
            orderServices: require('../models/order_services'),
        });

        const pipeline = buildFinancialOverviewPipeline({
            baseFilter: { _id: order._id, deleted_at: null },
            searchRegex: null,
            sortStage: { created_at: -1 },
            skip: 0,
            limit: 1,
            collections,
        });

        const result = await Order.aggregate(pipeline).exec();
        const row = result[0]?.data?.[0];
        if (!row) {
            return fail(404, 'Order not found.');
        }

        return ok(200, {
            message: 'Financial order payment fetched successfully.',
            source: 'order',
            record: shapeFinancialOverviewRecord(row, 1),
        });
    } catch (err) {
        console.error('getFinancialOrderPaymentById', err);
        return fail(500, 'Internal server error.');
    }
};

const shapePartnerMobileFinancialRecord = (row, srNo) => {
    const full = shapeFinancialOverviewRecord(row, srNo);
    return {
        sr_no: full.sr_no,
        _id: full._id,
        order_id: full.order_id,
        order_unique_id: full.order_unique_id,
        user_name: full.user_name,
        service_name: full.service_name,
        service_date: full.service_date,
        total_earning: full.total_partner_amount,
        paid_amount: full.paid_to_partner,
        pending_amount: full.pending_to_partner,
        payment_status: full.partner_payment_status,
        order_status: full.order_status,
        order_status_canonical: full.order_status_canonical,
        created_at: full.created_at,
        updated_at: full.updated_at,
    };
};

const shapePartnerMobileOrderPaymentLine = (row) => ({
    _id: String(row._id),
    order_id: String(row.order_id),
    payer_type: row.payer_type,
    amount: roundMoney(row.amount),
    payment_method: row.payment_method || '',
    status: row.status || 'pending',
    transaction_reference: row.transaction_reference || '',
    installment_index: row.installment_index ?? null,
    due_date: row.due_date || null,
    paid_at: row.paid_at || null,
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const buildPartnerFinancialPaymentsTotals = async (baseFilter = {}) => {
    const match = { deleted_at: null, ...baseFilter };
    const collections = getListCollectionNames({
        orderServices: require('../models/order_services'),
    });

    const result = await Order.aggregate([
        { $match: match },
        ...buildPartnerPendingLookupStages(collections.orderServices),
        {
            $group: {
                _id: null,
                total_orders: { $sum: 1 },
                total_partner_amount: { $sum: '$_partner_entitlement' },
                total_paid_to_partner: {
                    $sum: { $ifNull: ['$partner_paid_amount', 0] },
                },
                total_pending_to_partner: { $sum: '$_partner_pending' },
                total_completed_orders: {
                    $sum: {
                        $cond: [
                            {
                                $in: [
                                    '$order_status',
                                    [ORDER_STATUS_COMPLETED, 'completed', 3],
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
                total_in_progress_orders: {
                    $sum: {
                        $cond: [
                            {
                                $in: [
                                    '$order_status',
                                    [
                                        ORDER_STATUS_IN_PROGRESS,
                                        'in_progress',
                                        'in-progress',
                                        1,
                                        2,
                                    ],
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
            },
        },
    ]);

    const row = result[0] || {};
    return {
        total_orders: row.total_orders || 0,
        total_partner_amount: roundMoney(row.total_partner_amount),
        total_paid_to_partner: roundMoney(row.total_paid_to_partner),
        total_pending_to_partner: roundMoney(row.total_pending_to_partner),
        total_completed_orders: row.total_completed_orders || 0,
        total_in_progress_orders: row.total_in_progress_orders || 0,
    };
};

const buildPartnerFinancialListBaseFilter = (partnerOid, query = {}) => {
    const statusFilterResult = resolveFinancialListOrderStatusFilter(query.order_status);
    if (!statusFilterResult.ok) {
        return statusFilterResult;
    }

    if (
        query.partner_payment_status &&
        !isValidPartnerPaymentStatus(String(query.partner_payment_status).trim().toLowerCase())
    ) {
        return {
            ok: false,
            message: 'Invalid partner payment status. Use: unpaid, partially_paid, paid.',
        };
    }

    const dateRangeResult = buildOrderDateRangeFilter(query);
    if (!dateRangeResult.ok) {
        return dateRangeResult;
    }

    const baseFilter = {
        partner_id: partnerOid,
        ...dateRangeResult.filter,
        ...statusFilterResult.filter,
    };

    if (query.partner_payment_status) {
        baseFilter.partner_payment_status = String(query.partner_payment_status).trim().toLowerCase();
    }

    return { ok: true, baseFilter };
};

const listPartnerFinancialOrderPayments = async (partnerOid, query = {}, searchRegex = null) => {
    try {
        const baseResult = buildPartnerFinancialListBaseFilter(partnerOid, query);
        if (!baseResult.ok) {
            return fail(400, baseResult.message);
        }

        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const skip = (page - 1) * limit;

        const baseFilter = { deleted_at: null, ...baseResult.baseFilter };
        const { sort: sortStage, collation } = buildListSort(query);
        const collections = getListCollectionNames({
            users: User,
            services: Service,
            orderServices: require('../models/order_services'),
        });

        const pipeline = buildFinancialOverviewPipeline({
            baseFilter,
            searchRegex,
            sortStage,
            skip,
            limit,
            collections,
        });

        let agg = Order.aggregate(pipeline);
        if (collation) {
            agg = agg.collation(collation);
        }

        const [result, totals] = await Promise.all([agg.exec(), buildPartnerFinancialPaymentsTotals(baseFilter)]);

        const { data: rows, totalCount, totalPages } = parseFacetListResult(result, limit);
        const records = rows.map((row, index) =>
            shapePartnerMobileFinancialRecord(row, skip + index + 1)
        );

        return ok(200, {
            message: 'Partner order payments fetched successfully.',
            source: 'order',
            totalItems: totalCount,
            totalPages,
            currentPage: page,
            totals,
            records,
        });
    } catch (err) {
        console.error('listPartnerFinancialOrderPayments', err);
        return fail(500, 'Internal server error.');
    }
};

const getPartnerFinancialOrderPaymentById = async (partnerOid, orderId) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return fail(400, 'Invalid order id.');
        }

        const order = await Order.findOne({
            _id: orderId,
            partner_id: partnerOid,
            deleted_at: null,
        }).lean();
        if (!order) {
            return fail(404, 'Order not found.');
        }

        const syncResult = await syncOrderPaymentStatus(order._id);
        const syncedOrder = syncResult?.order;

        const collections = getListCollectionNames({
            users: User,
            services: Service,
            orderServices: require('../models/order_services'),
        });

        const [aggregateResult, paymentRows, partnerSummary] = await Promise.all([
            Order.aggregate(
                buildFinancialOverviewPipeline({
                    baseFilter: { _id: order._id, partner_id: partnerOid, deleted_at: null },
                    searchRegex: null,
                    sortStage: { created_at: -1 },
                    skip: 0,
                    limit: 1,
                    collections,
                })
            ).exec(),
            OrderPayment.find({ order_id: order._id, deleted_at: null })
                .sort({ created_at: -1 })
                .lean(),
            syncedOrder
                ? buildPartnerOrderSummaryFromOrderDoc(
                      typeof syncedOrder.toObject === 'function'
                          ? syncedOrder.toObject()
                          : syncedOrder
                  )
                : null,
        ]);

        const row = aggregateResult[0]?.data?.[0];
        if (!row) {
            return fail(404, 'Order not found.');
        }

        return ok(200, {
            message: 'Partner order payment fetched successfully.',
            source: 'order',
            record: shapePartnerMobileFinancialRecord(row, 1),
            partner_summary: partnerSummary,
            order_payments: paymentRows.map(shapePartnerMobileOrderPaymentLine),
        });
    } catch (err) {
        console.error('getPartnerFinancialOrderPaymentById', err);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    listFinancialOrderPayments,
    getFinancialOrderPaymentById,
    buildFinancialOrderPaymentsCountFromOrders,
    shapeFinancialOverviewRecord,
    listPartnerFinancialOrderPayments,
    getPartnerFinancialOrderPaymentById,
    buildPartnerFinancialPaymentsTotals,
    shapePartnerMobileFinancialRecord,
    shapePartnerMobileOrderPaymentLine,
};
