const Quote = require('../models/quote');
const Order = require('../models/order');
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
const { buildFieldDateRangeFilter } = require('../utils/schedule_date_filters');
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

const resolveDashboardDateRange = (query = {}) => {
    const hasFrom =
        query.from_date !== undefined &&
        query.from_date !== null &&
        String(query.from_date).trim() !== '';
    const hasTo =
        query.to_date !== undefined &&
        query.to_date !== null &&
        String(query.to_date).trim() !== '';

    if (!hasFrom && !hasTo) {
        const today = new Date().toISOString().slice(0, 10);
        return buildFieldDateRangeFilter({ from_date: today, to_date: today }, 'created_at');
    }

    return buildFieldDateRangeFilter(query, 'created_at');
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

const buildPaymentDashboardTotals = async (req, franchiseOid, dateFilter) => {
    const franchiseQuery = franchiseOid ? franchiseOid.toString() : undefined;
    const scopeResult = await resolveOrderListScope(req, {
        franchiseIdFromQuery: franchiseQuery,
    });
    if (!scopeResult.ok) {
        return scopeResult;
    }

    const match = { deleted_at: null, ...scopeResult.filter, ...dateFilter };

    const result = await Order.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                customer: {
                    $sum: {
                        $ifNull: ['$customer_net_paid', { $ifNull: ['$customer_paid_amount', 0] }],
                    },
                },
                partner: { $sum: { $ifNull: ['$partner_paid_amount', 0] } },
                commission: { $sum: { $ifNull: ['$admin_earning', 0] } },
            },
        },
    ]);

    const row = result[0] || {};
    const customer = roundMoney(row.customer);
    const partner = roundMoney(row.partner);
    const commission = roundMoney(row.commission);

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
    const dateRangeResult = resolveDashboardDateRange(req.query || {});
    if (!dateRangeResult.ok) {
        return fail(400, dateRangeResult.message);
    }

    const franchiseScopeResult = await resolveDashboardFranchiseScope(req);
    if (!franchiseScopeResult.ok) {
        return fail(franchiseScopeResult.status, franchiseScopeResult.message);
    }

    const { franchiseOid } = franchiseScopeResult.data;
    const dateFilter = dateRangeResult.filter;

    const [quotesResult, ordersResult, paymentsResult, servicesResult, partnersResult] =
        await Promise.all([
            buildQuoteDashboardCounts(req, franchiseOid, dateFilter),
            buildOrderDashboardCounts(req, franchiseOid, dateFilter),
            buildPaymentDashboardTotals(req, franchiseOid, dateFilter),
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

    const rangeFrom = dateFilter.created_at?.$gte ?? null;
    const rangeTo = dateFilter.created_at?.$lte ?? null;

    return ok({
        franchise_id: franchiseOid ? String(franchiseOid) : null,
        from_date: formatDateOnly(rangeFrom) || formatDateOnly(startOfUtcDay(new Date())),
        to_date: formatDateOnly(rangeTo) || formatDateOnly(endOfUtcDay(new Date())),
        quotes: quotesResult.data,
        orders: ordersResult.data,
        payments: paymentsResult.data,
        services: servicesResult.data,
        partners: partnersResult.data,
    });
};

module.exports = {
    buildAdminDashboardStats,
    resolveDashboardDateRange,
    resolveDashboardFranchiseScope,
};
