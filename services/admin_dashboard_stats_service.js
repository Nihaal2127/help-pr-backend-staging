const Quote = require('../models/quote');
const Order = require('../models/order');
const OrderPayment = require('../models/order_payment');
const Service = require('../models/service');
const User = require('../models/user');
const { buildQuoteBucketFilter } = require('../enum/quote_status_enum');
const {
    ORDER_STATUS_IN_PROGRESS,
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_CANCELLED,
    buildOrderManagementStatusQueryFilter,
} = require('../enum/order_status_enum');
const { resolveQuoteListScope } = require('../utils/quote_access');
const { resolveOrderListScope } = require('../utils/order_access');
const {
    pickFranchiseIdFromReq,
    parseFranchiseObjectId,
    assertFranchiseAccess,
} = require('../utils/franchise_access');
const { loadFranchiseCallerScope } = require('../utils/franchise_user_scope');
const {
    buildScheduleDateRangeCore,
    buildFieldDateRangeFilter,
    buildOrderDateRangeFilter,
} = require('../utils/schedule_date_filters');
const { startOfUtcDay, endOfUtcDay } = require('../utils/date_bounds');
const { countFranchiseScopedCatalogDashboard } = require('../utils/franchise_catalog_dashboard_counts');

const fail = (status, message) => ({ ok: false, status, message });
const ok = (data) => ({ ok: true, data });

const roundMoney = (n) => Math.round(Number(n || 0) * 100) / 100;

const formatDateOnly = (date) => {
    if (!date) return null;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
};

/** UTC day bounds when from_date / to_date are sent; no default range when omitted. */
const resolveDashboardDateBounds = (query = {}) => {
    const core = buildScheduleDateRangeCore(query);
    if (!core.ok) {
        return core;
    }

    if (core.noDateParams) {
        return { ok: true, rangeFrom: null, rangeTo: null, hasDateFilter: false };
    }

    let { rangeFrom, rangeTo, hasFrom, hasTo, parsedFrom, parsedTo } = core;

    if (hasFrom && !hasTo && parsedFrom) {
        rangeTo = endOfUtcDay(parsedFrom);
    } else if (!hasFrom && hasTo && parsedTo) {
        rangeFrom = startOfUtcDay(parsedTo);
    }

    if (rangeFrom && rangeTo && rangeTo < rangeFrom) {
        return {
            ok: false,
            message: 'To date filter must be on or after from date filter.',
        };
    }

    return { ok: true, rangeFrom, rangeTo, hasDateFilter: true };
};

const resolveDashboardDateFilters = (query = {}) => {
    const bounds = resolveDashboardDateBounds(query);
    if (!bounds.ok) {
        return bounds;
    }

    if (!bounds.hasDateFilter) {
        return {
            ok: true,
            rangeFrom: null,
            rangeTo: null,
            hasDateFilter: false,
            quoteDateFilter: {},
            orderDateFilter: {},
        };
    }

    const quoteDateResult = buildFieldDateRangeFilter(query, 'created_at');
    if (!quoteDateResult.ok) {
        return quoteDateResult;
    }

    const orderDateResult = buildOrderDateRangeFilter(query);
    if (!orderDateResult.ok) {
        return orderDateResult;
    }

    return {
        ok: true,
        rangeFrom: bounds.rangeFrom,
        rangeTo: bounds.rangeTo,
        hasDateFilter: true,
        quoteDateFilter: quoteDateResult.filter,
        orderDateFilter: orderDateResult.filter,
    };
};

const resolveDashboardFranchiseScope = async (req) => {
    const raw = pickFranchiseIdFromReq(req);
    let franchiseOid = null;

    if (raw) {
        const parsed = parseFranchiseObjectId(raw);
        if (!parsed.ok) {
            return fail(409, parsed.message);
        }
        franchiseOid = parsed.oid;
    } else if (req.user?.id) {
        const callerScope = await loadFranchiseCallerScope(req.user.id);
        if (callerScope?.isFranchiseStaff && callerScope.franchiseOid) {
            franchiseOid = callerScope.franchiseOid;
        }
    }

    if (franchiseOid) {
        const access = await assertFranchiseAccess(req.user, franchiseOid);
        if (!access.ok) {
            return fail(access.status, access.message);
        }
    }

    return ok({ franchiseOid });
};

const buildScopedOrderIdFilter = async (scopeFilter = {}) => {
    const ids = await Order.find({ deleted_at: null, ...scopeFilter }).distinct('_id');
    if (ids.length === 0) {
        return { order_id: { $in: [] } };
    }
    return { order_id: { $in: ids } };
};

const legacyOrderMoneyGroupStage = {
    $group: {
        _id: null,
        customer: {
            $sum: {
                $let: {
                    vars: {
                        netPaid: { $ifNull: ['$customer_net_paid', 0] },
                        paidAmt: { $ifNull: ['$customer_paid_amount', 0] },
                        totalPrice: { $ifNull: ['$total_price', 0] },
                        isPaid: { $ifNull: ['$is_paid', false] },
                    },
                    in: {
                        $cond: [
                            { $gt: ['$$netPaid', 0] },
                            '$$netPaid',
                            {
                                $cond: [
                                    { $gt: ['$$paidAmt', 0] },
                                    '$$paidAmt',
                                    {
                                        $cond: [
                                            {
                                                $and: [
                                                    '$$isPaid',
                                                    { $gt: ['$$totalPrice', 0] },
                                                ],
                                            },
                                            '$$totalPrice',
                                            0,
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        },
        partner: { $sum: { $ifNull: ['$partner_paid_amount', 0] } },
        commission: {
            $sum: {
                $ifNull: ['$admin_earning', { $ifNull: ['$commission_amount', 0] }],
            },
        },
    },
};

const buildQuoteDashboardCounts = async (req, franchiseOid, dateFilter) => {
    const franchiseQuery = franchiseOid ? franchiseOid.toString() : undefined;
    const scopeResult = await resolveQuoteListScope(req, {
        franchiseIdFromQuery: franchiseQuery,
    });
    if (!scopeResult.ok) {
        return scopeResult;
    }

    const baseFilter = { deleted_at: null, ...scopeResult.filter, ...dateFilter };

    const [requestsReceived, pendingCount, acceptedCount, completed, cancelled] =
        await Promise.all([
            Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter('new') }),
            Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter('pending') }),
            Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter('accepted') }),
            Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter('success') }),
            Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter('failed') }),
        ]);

    return ok({
        requests_received: requestsReceived,
        in_progress: pendingCount + acceptedCount,
        completed,
        cancelled,
    });
};

const buildOrderDashboardCounts = async (req, franchiseOid, dateFilter) => {
    const franchiseQuery = franchiseOid ? franchiseOid.toString() : undefined;
    const scopeResult = await resolveOrderListScope(req, {
        franchiseIdFromQuery: franchiseQuery,
    });
    if (!scopeResult.ok) {
        return scopeResult;
    }

    const baseFilter = { deleted_at: null, ...scopeResult.filter, ...dateFilter };

    const [inProgress, completed, cancelled] = await Promise.all([
        Order.countDocuments({
            ...baseFilter,
            ...buildOrderManagementStatusQueryFilter(ORDER_STATUS_IN_PROGRESS),
        }),
        Order.countDocuments({
            ...baseFilter,
            ...buildOrderManagementStatusQueryFilter(ORDER_STATUS_COMPLETED),
        }),
        Order.countDocuments({
            ...baseFilter,
            ...buildOrderManagementStatusQueryFilter(ORDER_STATUS_CANCELLED),
        }),
    ]);

    return ok({
        in_progress: inProgress,
        completed,
        cancelled,
    });
};

/**
 * Payments: sum completed order_payment rows by paid_at (fallback created_at) in range,
 * plus legacy is_paid orders without customer payment rows (order schedule date filter).
 */
const buildPaymentDashboardTotals = async (
    req,
    franchiseOid,
    rangeFrom,
    rangeTo,
    orderDateFilter
) => {
    const franchiseQuery = franchiseOid ? franchiseOid.toString() : undefined;
    const scopeResult = await resolveOrderListScope(req, {
        franchiseIdFromQuery: franchiseQuery,
    });
    if (!scopeResult.ok) {
        return scopeResult;
    }

    const scopedOrderFilter = await buildScopedOrderIdFilter(scopeResult.filter);

    const paymentPipeline = [
        {
            $match: {
                deleted_at: null,
                status: 'completed',
                ...scopedOrderFilter,
            },
        },
    ];

    if (rangeFrom && rangeTo) {
        paymentPipeline.push(
            {
                $addFields: {
                    payment_date: { $ifNull: ['$paid_at', '$created_at'] },
                },
            },
            {
                $match: {
                    payment_date: { $gte: rangeFrom, $lte: rangeTo },
                },
            }
        );
    }

    paymentPipeline.push({
        $group: {
            _id: null,
            customer: {
                $sum: {
                    $cond: [{ $eq: ['$payer_type', 'customer'] }, '$amount', 0],
                },
            },
            partner: {
                $sum: {
                    $cond: [{ $eq: ['$payer_type', 'partner'] }, '$amount', 0],
                },
            },
            customer_order_ids: {
                $addToSet: {
                    $cond: [{ $eq: ['$payer_type', 'customer'] }, '$order_id', null],
                },
            },
        },
    });

    const [paymentAgg, orderIdsWithCustomerPayments] = await Promise.all([
        OrderPayment.aggregate(paymentPipeline),
        OrderPayment.distinct('order_id', {
            deleted_at: null,
            payer_type: 'customer',
            ...scopedOrderFilter,
        }),
    ]);

    const paymentRow = paymentAgg[0] || {};
    let customer = roundMoney(paymentRow.customer || 0);
    let partner = roundMoney(paymentRow.partner || 0);
    let commission = 0;

    const customerOrderIds = (paymentRow.customer_order_ids || []).filter(Boolean);
    if (customerOrderIds.length > 0) {
        const commissionAgg = await Order.aggregate([
            {
                $match: {
                    _id: { $in: customerOrderIds },
                    deleted_at: null,
                },
            },
            {
                $group: {
                    _id: null,
                    commission: {
                        $sum: {
                            $ifNull: [
                                '$admin_earning',
                                { $ifNull: ['$commission_amount', 0] },
                            ],
                        },
                    },
                },
            },
        ]);
        commission = roundMoney(commissionAgg[0]?.commission || 0);
    }

    const legacyAgg = await Order.aggregate([
        {
            $match: {
                deleted_at: null,
                ...scopeResult.filter,
                ...orderDateFilter,
                _id: { $nin: orderIdsWithCustomerPayments },
                $or: [
                    { is_paid: true, total_price: { $gt: 0 } },
                    { customer_net_paid: { $gt: 0 } },
                    { customer_paid_amount: { $gt: 0 } },
                    { partner_paid_amount: { $gt: 0 } },
                    { admin_earning: { $gt: 0 } },
                    { commission_amount: { $gt: 0 } },
                ],
            },
        },
        legacyOrderMoneyGroupStage,
    ]);

    const legacyRow = legacyAgg[0] || {};
    customer = roundMoney(customer + (legacyRow.customer || 0));
    partner = roundMoney(partner + (legacyRow.partner || 0));
    commission = roundMoney(commission + (legacyRow.commission || 0));

    return ok({
        total_payments: roundMoney(customer + partner + commission),
        customer,
        partner,
        commission,
    });
};

const buildServiceDashboardCounts = async (franchiseOid) => {
    if (franchiseOid) {
        const serviceCounts = await countFranchiseScopedCatalogDashboard([franchiseOid], 'service');
        const total = serviceCounts.total_catalog ?? serviceCounts.total ?? 0;
        const active = serviceCounts.locally_enabled ?? serviceCounts.active ?? 0;
        return ok({
            total,
            active,
            inactive: Math.max(0, total - active),
        });
    }

    const serviceFilter = { deleted_at: null, is_request: false };
    const [total, active, inactive] = await Promise.all([
        Service.countDocuments(serviceFilter),
        Service.countDocuments({ ...serviceFilter, is_active: true }),
        Service.countDocuments({ ...serviceFilter, is_active: false }),
    ]);

    return ok({ total, active, inactive });
};

const buildPartnerDashboardCounts = async (franchiseOid) => {
    const partnerBase = {
        type: 2,
        deleted_at: null,
        verification_status: 2,
        ...(franchiseOid ? { franchise_id: franchiseOid } : {}),
    };

    const [total, active, inactive] = await Promise.all([
        User.countDocuments(partnerBase),
        User.countDocuments({ ...partnerBase, is_blocked: false, is_active: true }),
        User.countDocuments({ ...partnerBase, is_blocked: false, is_active: false }),
    ]);

    return ok({ total, active, inactive });
};

const buildAdminDashboardStats = async (req) => {
    const dateFiltersResult = resolveDashboardDateFilters(req.query || {});
    if (!dateFiltersResult.ok) {
        return fail(400, dateFiltersResult.message);
    }

    const franchiseScopeResult = await resolveDashboardFranchiseScope(req);
    if (!franchiseScopeResult.ok) {
        return fail(franchiseScopeResult.status, franchiseScopeResult.message);
    }

    const { franchiseOid } = franchiseScopeResult.data;
    const {
        rangeFrom,
        rangeTo,
        quoteDateFilter,
        orderDateFilter,
    } = dateFiltersResult;

    const [quotesResult, ordersResult, paymentsResult, servicesResult, partnersResult] =
        await Promise.all([
            buildQuoteDashboardCounts(req, franchiseOid, quoteDateFilter),
            buildOrderDashboardCounts(req, franchiseOid, orderDateFilter),
            buildPaymentDashboardTotals(
                req,
                franchiseOid,
                rangeFrom,
                rangeTo,
                orderDateFilter
            ),
            buildServiceDashboardCounts(franchiseOid),
            buildPartnerDashboardCounts(franchiseOid),
        ]);

    if (!quotesResult.ok) {
        return fail(quotesResult.status, quotesResult.message);
    }
    if (!ordersResult.ok) {
        return fail(ordersResult.status, ordersResult.message);
    }
    if (!paymentsResult.ok) {
        return fail(paymentsResult.status, paymentsResult.message);
    }
    if (!servicesResult.ok) {
        return fail(servicesResult.status, servicesResult.message);
    }
    if (!partnersResult.ok) {
        return fail(partnersResult.status, partnersResult.message);
    }

    return ok({
        franchise_id: franchiseOid ? String(franchiseOid) : null,
        from_date: dateFiltersResult.hasDateFilter
            ? formatDateOnly(dateFiltersResult.rangeFrom)
            : null,
        to_date: dateFiltersResult.hasDateFilter
            ? formatDateOnly(dateFiltersResult.rangeTo)
            : null,
        quotes: quotesResult.data,
        orders: ordersResult.data,
        payments: paymentsResult.data,
        services: servicesResult.data,
        partners: partnersResult.data,
    });
};

module.exports = {
    buildAdminDashboardStats,
    resolveDashboardDateFilters,
    resolveDashboardDateBounds,
    resolveDashboardFranchiseScope,
};
