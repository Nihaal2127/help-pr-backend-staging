const mongoose = require('mongoose');
const State = require('../models/state');
const City = require('../models/city');
const Area = require('../models/area');
const Address = require('../models/address');
const User = require('../models/user');
const PartnerDocument = require('../models/partner_document');
const Category = require('../models/category');
const Service = require('../models/service');
const OrderService = require('../models/order_services');
const Order = require('../models/order');
const PartnerService = require('../models/partner_service');
const Franchise = require('../models/franchise');
const Expense = require('../models/expense');
const ExpenseCategory = require('../models/expense_category');
const ContentManagement = require('../models/content_management');
const Quote = require('../models/quote');
const SubscriptionPlan = require('../models/subscription_plan');
const PartnerSubscription = require('../models/partner_subscription');
const Offer = require('../models/offer');
const FinancialOrder = require('../models/financial_order');
const { checkObjectIdExists } = require('../validator/id_validator');
const { resolveOrderListScope } = require('../utils/order_access');
const { resolveQuoteListScope } = require('../utils/quote_access');
const {
  ORDER_STATUS_IN_PROGRESS,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_REFUNDED,
  buildOrderStatusQueryFilter,
} = require('../enum/order_status_enum');
const moment = require("moment-timezone");
const {
    countFranchiseScopedCatalogDashboard,
    countFranchiseScopedRequestedCatalog,
} = require('../utils/franchise_catalog_dashboard_counts');
const { loadFranchiseCallerScope } = require('../utils/franchise_user_scope');

const pickFirstNonEmpty = (...values) => {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value).trim();
        }
    }
    return null;
};

/**
 * Franchise scope from body, headers, or query: `franchise` (preferred) or `franchise_id`.
 * Matches franchise-category / franchise-service list APIs (query `franchise_id`).
 */
const parseOptionalFranchiseScope = (req) => {
    const pick = pickFirstNonEmpty(
        req.body?.franchise,
        req.body?.franchise_id,
        req.headers?.franchise,
        req.headers?.franchise_id,
        req.query?.franchise,
        req.query?.franchise_id
    );
    if (pick === null) {
        return { ok: true, oid: null };
    }
    if (!mongoose.Types.ObjectId.isValid(pick)) {
        return { ok: false, status: 409, message: 'Invalid franchise id.' };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(pick) };
};

/** Count type from body, headers, or query (e.g. service-management, my-franchise). */
const resolveCountTypeFromRequest = (req) => {
    const raw = pickFirstNonEmpty(req.body?.type, req.headers?.type, req.query?.type);
    return resolveCountType(raw);
};

const assertFranchiseAccess = async (req, franchiseOid) => {
    const caller = await User.findOne({ _id: req.user.id, deleted_at: null })
        .select('type franchise_id')
        .lean();
    if (!caller) {
        return { ok: false, status: 401, message: 'User not found.' };
    }
    const fr = await Franchise.findOne({ _id: franchiseOid, deleted_at: null }).select('admin_id').lean();
    if (!fr) {
        return { ok: false, status: 404, message: 'Franchise not found.' };
    }
    const ft = Number(caller.type);
    if (ft === 5 || ft === 6) {
        return { ok: true };
    }
    if (ft === 1) {
        if (caller.franchise_id && caller.franchise_id.toString() === franchiseOid.toString()) {
            return { ok: true };
        }
        if (fr.admin_id && fr.admin_id.toString() === String(req.user.id)) {
            return { ok: true };
        }
        return { ok: false, status: 403, message: 'You are not allowed to view counts for this franchise.' };
    }
    if (ft === 3) {
        if (caller.franchise_id && caller.franchise_id.toString() === franchiseOid.toString()) {
            return { ok: true };
        }
        return { ok: false, status: 403, message: 'You are not allowed to view counts for this franchise.' };
    }
    return { ok: false, status: 403, message: 'You are not allowed to view counts for this franchise.' };
};

/** Order model has no franchise_id; scope via quotes + staff-created orders. */
const buildFranchiseScopedCompletedOrderIds = async (franchiseOid) => {
    const staffIds = await User.find({
        franchise_id: franchiseOid,
        type: { $in: [1, 3] },
        deleted_at: null,
    }).distinct('_id');

    const quoteOrderIds = await Quote.find({
        franchise_id: franchiseOid,
        deleted_at: null,
        order_id: { $ne: null },
    }).distinct('order_id');

    const idSet = new Set();
    for (const id of quoteOrderIds) {
        if (id) idSet.add(id.toString());
    }
    if (staffIds.length > 0) {
        const staffOrderIds = await Order.find({
            deleted_at: null,
            created_by_id: { $in: staffIds },
        }).distinct('_id');
        for (const id of staffOrderIds) {
            if (id) idSet.add(id.toString());
        }
    }
    if (idSet.size === 0) {
        return [];
    }
    const candidates = Array.from(idSet, (s) => new mongoose.Types.ObjectId(s));
    return Order.find({
        _id: { $in: candidates },
        deleted_at: null,
        order_status: 'completed',
    }).distinct('_id');
};

const resolveCountType = (type) => {
    if (typeof type === 'number' && !Number.isNaN(type)) return type;
    if (typeof type !== 'string') return null;

    // Strip BOM / zero-width space so Postman or editors don't break the map key
    const trimmedType = type.replace(/\uFEFF/g, '').replace(/\u200B/g, '').trim();
    if (trimmedType === '') return null;

    if (/^\d+$/.test(trimmedType)) {
        return parseInt(trimmedType, 10);
    }

    const normalize = (value) => String(value).trim().toLowerCase().replace(/^\/+|\/+$/g, '');
    let key = normalize(trimmedType);

    if (key.startsWith('http://') || key.startsWith('https://')) {
        try {
            const parsedUrl = new URL(trimmedType);
            const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
            key = normalize(pathParts[pathParts.length - 1] || '');
        } catch (error) {
            key = normalize(trimmedType.split('/').filter(Boolean).pop() || '');
        }
    } else {
        key = normalize(trimmedType.split('/').filter(Boolean).pop() || key);
    }

    const typeMap = {
        'location-management': 1,
        'service-management': 2,
        'user-management': 3,
        'financials': 4,
        'order-payment': 4,
        'financial-order-payments': 4,
        financial_order_payments: 4,
        'partner-management': 12,
        'partner-payment': 5,
        'franchise-management': 6,
        'expenses': 7,
        'settings-expense-categories': 8,
        'content-management': 9,
        'my-franchise': 10,
        my_franchise: 10,
        'quote-management': 11,
        quote_management: 11,
        quotes: 11,
        'settings-role': 13,
        settings_role: 13,
        settingsrole: 13,
        'order-management': 14,
        order_management: 14,
        orders: 14,
        'settings-offers': 15,
        settings_offers: 15,
        'offers-management': 15,
        offers_management: 15,
    };

    return typeMap[key] ?? null;
};

/** Success payload for POST /api/getCount — only top-level `record` (no `records`). */
const buildGetCountSuccessBody = (response) => {
    const record = JSON.parse(JSON.stringify(response));
    if (record && typeof record === 'object' && !Array.isArray(record)) {
        delete record.records;
    }
    return {
        success: true,
        status: 200,
        record,
    };
};

/** Global Category/Service dashboard rows (no franchise scope). */
const buildGlobalCategoryServiceCountRecord = async () => {
    const categoryFilter = { deleted_at: null };
    const serviceFilter = { deleted_at: null };
    return {
        total_category: await Category.countDocuments({ ...categoryFilter, is_request: false }),
        inactive_category: await Category.countDocuments({ ...categoryFilter, is_active: false, is_request: false }),
        active_category: await Category.countDocuments({ ...categoryFilter, is_active: true, is_request: false }),
        requested_category: await Category.countDocuments({ ...categoryFilter, is_request: true }),
        total_service: await Service.countDocuments({ ...serviceFilter, is_request: false }),
        inactive_service: await Service.countDocuments({ ...serviceFilter, is_active: false, is_request: false }),
        active_service: await Service.countDocuments({ ...serviceFilter, is_active: true, is_request: false }),
        requested_service: await Service.countDocuments({ ...serviceFilter, is_request: true }),
    };
};

/**
 * Category/service counts aligned with franchise-category|service getAll (all_* catalog)
 * and my-franchise / service-management getCount cards.
 * @param {mongoose.Types.ObjectId[]} franchiseIdsScope
 */
const buildFranchiseDashboardCategoryServiceCountRecord = async (franchiseIdsScope) => {
    const out = {
        total_category: 0,
        inactive_category: 0,
        active_category: 0,
        requested_category: 0,
        total_service: 0,
        inactive_service: 0,
        active_service: 0,
        requested_service: 0,
    };
    if (!franchiseIdsScope || franchiseIdsScope.length === 0) {
        return out;
    }

    const categoryCounts = await countFranchiseScopedCatalogDashboard(
        franchiseIdsScope,
        'category'
    );
    out.total_category = categoryCounts.total;
    out.active_category = categoryCounts.active;
    out.inactive_category = categoryCounts.inactive;

    const serviceCounts = await countFranchiseScopedCatalogDashboard(
        franchiseIdsScope,
        'service'
    );
    out.total_service = serviceCounts.total;
    out.active_service = serviceCounts.active;
    out.inactive_service = serviceCounts.inactive;

    out.requested_category = await countFranchiseScopedRequestedCatalog(
        franchiseIdsScope,
        'category'
    );
    out.requested_service = await countFranchiseScopedRequestedCatalog(
        franchiseIdsScope,
        'service'
    );

    return out;
};

const collectFranchiseAreaIdsFromLean = (franchiseLean) => {
    const seen = new Set();
    const oids = [];
    if (!franchiseLean || franchiseLean.area_id == null) return oids;
    const arr = Array.isArray(franchiseLean.area_id) ? franchiseLean.area_id : [franchiseLean.area_id];
    for (const item of arr) {
        let oid = null;
        if (item instanceof mongoose.Types.ObjectId) {
            oid = item;
        } else if (item && typeof item === 'object' && item._id) {
            oid = item._id;
        } else if (typeof item === 'string' && /^[a-fA-F0-9]{24}$/i.test(item.trim())) {
            oid = new mongoose.Types.ObjectId(item.trim());
        }
        if (!oid) continue;
        const k = oid.toString();
        if (seen.has(k)) continue;
        seen.add(k);
        oids.push(oid);
    }
    return oids;
};

/** Type-4 user ids with an address pincode in the franchise's linked areas (same as user getAll). */
const getFranchiseCustomerUserIdsByPincode = async (franchiseLean) => {
    const areaIds = collectFranchiseAreaIdsFromLean(franchiseLean);
    if (areaIds.length === 0) return [];

    const areas = await Area.find({
        _id: { $in: areaIds },
        deleted_at: null,
    })
        .select('pincodes')
        .lean();

    const allowedPins = [];
    const pinSeen = new Set();
    for (const a of areas) {
        for (const p of a.pincodes || []) {
            const t = String(p).trim();
            if (!t || pinSeen.has(t)) continue;
            pinSeen.add(t);
            allowedPins.push(t);
        }
    }
    if (allowedPins.length === 0) return [];

    const rows = await Address.aggregate([
        {
            $match: {
                deleted_at: null,
                user_id: { $exists: true, $ne: null },
            },
        },
        {
            $addFields: {
                pinNorm: {
                    $trim: {
                        input: {
                            $toString: { $ifNull: ['$pincode', ''] },
                        },
                    },
                },
            },
        },
        { $match: { pinNorm: { $in: allowedPins } } },
        { $group: { _id: '$user_id' } },
    ]);

    return rows.map((r) => r._id).filter(Boolean);
};

/** Customer filter for user-management counts (global or franchise + pincode scope). */
const buildUserManagementCustomerFilter = async (franchiseScopeOid) => {
    const base = { type: 4, deleted_at: null };
    if (!franchiseScopeOid) {
        return base;
    }

    const franchise = await Franchise.findOne({ _id: franchiseScopeOid, deleted_at: null })
        .select('area_id')
        .lean();
    if (!franchise) {
        return { ...base, franchise_id: franchiseScopeOid };
    }

    const pincodeUserIds = await getFranchiseCustomerUserIdsByPincode(franchise);
    const orClause = [{ franchise_id: franchiseScopeOid }];
    if (pincodeUserIds.length > 0) {
        orClause.push({ _id: { $in: pincodeUserIds } });
    }
    return { ...base, $or: orClause };
};

/** Pending partners: franchise + unassigned (document verification pending). */
const buildVerificationPendingPartnerFilter = (franchiseScopeOid) => {
    const base = { type: 2, deleted_at: null, verification_status: 1 };
    if (!franchiseScopeOid) {
        return base;
    }
    return {
        ...base,
        $or: [
            { franchise_id: franchiseScopeOid },
            { franchise_id: null },
            { franchise_id: { $exists: false } },
        ],
    };
};

/** Rejected partners: selected franchise only. */
const buildVerificationRejectedPartnerFilter = (franchiseScopeOid) => {
    const base = { type: 2, deleted_at: null, verification_status: 3 };
    if (!franchiseScopeOid) {
        return base;
    }
    return { ...base, franchise_id: franchiseScopeOid };
};

/** Verification total: franchise pending/rejected + unassigned pending. */
const buildVerificationTotalPartnerFilter = (franchiseScopeOid) => {
    if (!franchiseScopeOid) {
        return { type: 2, deleted_at: null };
    }
    return {
        type: 2,
        deleted_at: null,
        $or: [
            { franchise_id: franchiseScopeOid, verification_status: { $in: [1, 3] } },
            { verification_status: 1, franchise_id: null },
            { verification_status: 1, franchise_id: { $exists: false } },
        ],
    };
};

/** getVerificationAll franchise scope (same rules as verification counts above). */
const buildVerificationListFranchiseFilter = (franchiseOid, verificationFilter) => {
    const rawStatus = verificationFilter?.verification_status;
    const statuses = rawStatus?.$in
        ? rawStatus.$in
        : rawStatus !== undefined
          ? [rawStatus]
          : [1, 3];

    if (statuses.length === 1 && statuses[0] === 3) {
        return { franchise_id: franchiseOid };
    }

    if (statuses.length === 1 && statuses[0] === 1) {
        return {
            $or: [
                { franchise_id: franchiseOid },
                { franchise_id: null },
                { franchise_id: { $exists: false } },
            ],
        };
    }

    return {
        $or: [
            { franchise_id: franchiseOid, verification_status: { $in: [1, 3] } },
            { verification_status: 1, franchise_id: null },
            { verification_status: 1, franchise_id: { $exists: false } },
        ],
    };
};

const pickFranchiseIdFromRequest = (req) => {
    const candidates = [
        req.query?.franchise_id,
        req.query?.franchise,
        req.headers?.franchise_id,
        req.headers?.franchise,
    ];
    for (const value of candidates) {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value).trim();
        }
    }
    return null;
};

/**
 * User-management dashboard counts (type 3).
 * Without franchise: platform-wide. With franchise: scoped like user list APIs when franchise is sent in body.
 * @param {mongoose.Types.ObjectId | null} franchiseScopeOid
 */
const buildUserManagementCountRecord = async (franchiseScopeOid) => {
    const customerFilter = await buildUserManagementCustomerFilter(franchiseScopeOid);

    const total_user = await User.countDocuments(customerFilter);
    const inactive_user = await User.countDocuments({ ...customerFilter, is_active: false });
    const active_user = await User.countDocuments({ ...customerFilter, is_active: true });

    const partnerApprovedFilter = franchiseScopeOid
        ? { type: 2, deleted_at: null, verification_status: 2, franchise_id: franchiseScopeOid }
        : { type: 2, deleted_at: null, verification_status: 2 };
    const total_partner = await User.countDocuments(partnerApprovedFilter);
    const blocked_partner = await User.countDocuments({
        ...partnerApprovedFilter,
        is_blocked: true,
        is_active: false,
    });
    const inactive_partner = await User.countDocuments({
        ...partnerApprovedFilter,
        is_blocked: false,
        is_active: false,
    });
    const active_partner = await User.countDocuments({
        ...partnerApprovedFilter,
        is_blocked: false,
        is_active: true,
    });

    const total_document = await User.countDocuments(
        buildVerificationTotalPartnerFilter(franchiseScopeOid),
    );
    const pending_document = await User.countDocuments(
        buildVerificationPendingPartnerFilter(franchiseScopeOid),
    );
    const reject_document = await User.countDocuments(
        buildVerificationRejectedPartnerFilter(franchiseScopeOid),
    );

    return {
        total_user,
        inactive_user,
        active_user,
        total_partner,
        blocked_partner,
        inactive_partner,
        active_partner,
        total_document,
        pending_document,
        reject_document,
    };
};

/** Financial — Order Payments dashboard (financial_order collection). */
const buildFinancialOrderPaymentsCountRecord = async (franchiseScopeOid) => {
    const match = { deleted_at: null };
    if (franchiseScopeOid) {
        match.franchise_id = franchiseScopeOid;
    }

    const result = await FinancialOrder.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                total_completed_orders: {
                    $sum: { $cond: [{ $eq: ['$order_status', 'completed'] }, 1, 0] },
                },
                total_in_progress_orders: {
                    $sum: { $cond: [{ $eq: ['$order_status', 'in_progress'] }, 1, 0] },
                },
                total_partner_pending_amount: { $sum: '$pending_to_partner' },
                total_user_pending_amount: { $sum: '$customer_pending_amount' },
            },
        },
    ]);

    const roundMoney = (n) => Math.round(Number(n || 0) * 100) / 100;
    const row = result[0] || {};
    return {
        total_completed_orders: row.total_completed_orders || 0,
        total_in_progress_orders: row.total_in_progress_orders || 0,
        total_partner_pending_amount: roundMoney(row.total_partner_pending_amount),
        total_user_pending_amount: roundMoney(row.total_user_pending_amount),
    };
};

const getCountData = async (req, res) => {
    try {
        const resolvedType = resolveCountTypeFromRequest(req);
        if (resolvedType === null || resolvedType === undefined) {
            return res.status(400).json({
                success: false,
                status: 400,
                message:
                    'Invalid or unsupported count type. Send "type" in the JSON body, a request header, or query (e.g. "service-management", "my-franchise").',
            });
        }

        const parsedFranchise = parseOptionalFranchiseScope(req);
        if (!parsedFranchise.ok) {
            return res.status(parsedFranchise.status).json({
                success: false,
                status: parsedFranchise.status,
                message: parsedFranchise.message,
            });
        }
        let franchiseScopeOid = parsedFranchise.oid;
        if (!franchiseScopeOid && req.user?.id) {
            const callerScope = await loadFranchiseCallerScope(req.user.id);
            if (callerScope?.isFranchiseStaff && callerScope.franchiseOid) {
                franchiseScopeOid = callerScope.franchiseOid;
            }
        }
        if (franchiseScopeOid) {
            const access = await assertFranchiseAccess(req, franchiseScopeOid);
            if (!access.ok) {
                return res.status(access.status).json({
                    success: false,
                    status: access.status,
                    message: access.message,
                });
            }
        }

        const response = {}
        if (resolvedType === 1) {
            if (franchiseScopeOid) {
                const frDoc = await Franchise.findOne({ _id: franchiseScopeOid, deleted_at: null })
                    .select('state_id city_id area_id')
                    .lean();
                if (!frDoc) {
                    return res.status(404).json({
                        success: false,
                        status: 404,
                        message: 'Franchise not found.',
                    });
                }
                const stateId = frDoc.state_id;
                const cityId = frDoc.city_id;
                const areaIds = (frDoc.area_id || []).filter(Boolean);

                response.total_state = await State.countDocuments({ _id: stateId, deleted_at: null });
                response.inactive_state = await State.countDocuments({
                    _id: stateId,
                    is_active: false,
                    deleted_at: null,
                });
                response.active_state = await State.countDocuments({
                    _id: stateId,
                    is_active: true,
                    deleted_at: null,
                });

                response.total_city = await City.countDocuments({ _id: cityId, deleted_at: null });
                response.inactive_city = await City.countDocuments({
                    _id: cityId,
                    is_active: false,
                    deleted_at: null,
                });
                response.active_city = await City.countDocuments({
                    _id: cityId,
                    is_active: true,
                    deleted_at: null,
                });

                if (areaIds.length === 0) {
                    response.total_area = 0;
                    response.inactive_area = 0;
                    response.active_area = 0;
                } else {
                    const areaBase = { _id: { $in: areaIds }, deleted_at: null };
                    response.total_area = await Area.countDocuments(areaBase);
                    response.inactive_area = await Area.countDocuments({
                        ...areaBase,
                        is_active: false,
                    });
                    response.active_area = await Area.countDocuments({
                        ...areaBase,
                        is_active: { $ne: false },
                    });
                }
            } else {
                const total_state = await State.countDocuments({ deleted_at: null });
                const inactive_state = await State.countDocuments({ is_active: false, deleted_at: null });
                const active_state = await State.countDocuments({ is_active: true, deleted_at: null });

                const total_city = await City.countDocuments({ deleted_at: null });
                const inactive_city = await City.countDocuments({ is_active: false, deleted_at: null });
                const active_city = await City.countDocuments({ is_active: true, deleted_at: null });

                const total_area = await Area.countDocuments({ deleted_at: null });
                const inactive_area = await Area.countDocuments({ is_active: false, deleted_at: null });
                const active_area = await Area.countDocuments({ is_active: true, deleted_at: null });

                response.total_state = total_state;
                response.inactive_state = inactive_state;
                response.active_state = active_state;
                response.total_city = total_city;
                response.inactive_city = inactive_city;
                response.active_city = active_city;
                response.total_area = total_area;
                response.inactive_area = inactive_area;
                response.active_area = active_area;
            }

        } else if (resolvedType === 2) {
            // Service & category: franchise mapping counts (franchise-service / franchise-category getAll) when
            // franchise scope is sent (body, header, or query); global catalogue counts when omitted.
            if (franchiseScopeOid) {
                Object.assign(
                    response,
                    await buildFranchiseDashboardCategoryServiceCountRecord([franchiseScopeOid]),
                );
            } else {
                Object.assign(response, await buildGlobalCategoryServiceCountRecord());
            }

        } else if (resolvedType === 3) {
            // User-management: global counts when franchise omitted; franchise-scoped when body/header/query sends franchise (same as service-management).
            Object.assign(response, await buildUserManagementCountRecord(franchiseScopeOid));
        } else if (resolvedType === 4) {
            // Financial — Order Payments (financial_order rows; optional franchise_id filter)
            Object.assign(response, await buildFinancialOrderPaymentsCountRecord(franchiseScopeOid));
        } else if (resolvedType === 5) {
            // Partner Payment
            const osMatch = {
                deleted_at: null,
                service_status: 'completed',
                ...(franchiseScopeOid
                    ? { order_id: { $in: await buildFranchiseScopedCompletedOrderIds(franchiseScopeOid) } }
                    : {}),
            };
            const result = await OrderService.aggregate([
                {
                    $match: osMatch,
                },
                {
                    $group: {
                        _id: null,
                        completed_amount: {
                            $sum: { $cond: [{ $eq: ["$partner_paid_status", 2] }, "$partner_earning", 0] }
                        },
                        pending_amount: {
                            $sum: { $cond: [{ $eq: ["$partner_paid_status", 1] }, "$partner_earning", 0] }
                        },
                        returned_amount: {
                            $sum: { $cond: [{ $eq: ["$partner_paid_status", 3] }, "$partner_earning", 0] }
                        },
                    }
                },
            ]);
            if (result.length > 0) {
                const data = result[0];
                response.completed_amount = data.completed_amount;
                response.pending_amount = data.pending_amount;
                response.returned_amount = data.returned_amount;
            } else {
                response.completed_amount = 0;
                response.pending_amount = 0;
                response.returned_amount = 0;
            }
        } else if (resolvedType === 6) {
            // Franchise Management
            const caller = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type franchise_id');
            if (!caller) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: 'User not found.',
                });
            }

            const franchiseFilter = { deleted_at: null };
            if (franchiseScopeOid) {
                franchiseFilter._id = franchiseScopeOid;
            } else if (caller.type === 1) {
                franchiseFilter.admin_id = req.user.id;
            }

            const total_franchise = await Franchise.countDocuments({ ...franchiseFilter });
            const inactive_franchise = await Franchise.countDocuments({ ...franchiseFilter, is_active: false });
            const active_franchise = await Franchise.countDocuments({ ...franchiseFilter, is_active: true });

            response.total_franchise = total_franchise;
            response.inactive_franchise = inactive_franchise;
            response.active_franchise = active_franchise;
        } else if (resolvedType === 7) {
            // Expenses
            const caller = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type franchise_id');
            if (!caller) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: 'User not found.',
                });
            }

            const expenseFilter = { deleted_at: null };
            if (franchiseScopeOid) {
                expenseFilter.franchise_id = franchiseScopeOid;
            } else if (caller.type === 1) {
                if (!caller.franchise_id) {
                    expenseFilter.franchise_id = { $in: [] };
                } else {
                    expenseFilter.franchise_id = caller.franchise_id;
                }
            }

            const total_expense = await Expense.countDocuments(expenseFilter);
            response.total_expense = total_expense;
        } else if (resolvedType === 8) {
            // Expense Categories
            const caller = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type franchise_id');
            if (!caller) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: 'User not found.',
                });
            }

            const expenseCategoryFilter = { deleted_at: null };
            if (franchiseScopeOid) {
                expenseCategoryFilter.franchise_id = franchiseScopeOid;
            } else if (caller.type === 1) {
                if (!caller.franchise_id) {
                    expenseCategoryFilter.franchise_id = { $in: [] };
                } else {
                    expenseCategoryFilter.franchise_id = caller.franchise_id;
                }
            }

            const total_expense_category = await ExpenseCategory.countDocuments(expenseCategoryFilter);
            response.total_expense_category = total_expense_category;
        } else if (resolvedType === 9) {
            // Content Management
            const total_content = await ContentManagement.countDocuments({ deleted_at: null });
            response.total_content = total_content;
        } else if (resolvedType === 10) {
            // My Franchise — employees, franchise areas, category & service counts (scoped like type 2)
            const caller = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type franchise_id');
            if (!caller) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: 'User not found.',
                });
            }

            const setMyFranchiseZeros = () => {
                response.total_employee = 0;
                response.inactive_employee = 0;
                response.active_employee = 0;
                response.total_area = 0;
                response.inactive_area = 0;
                response.active_area = 0;
                response.total_category = 0;
                response.inactive_category = 0;
                response.active_category = 0;
                response.requested_category = 0;
                response.total_service = 0;
                response.inactive_service = 0;
                response.active_service = 0;
                response.requested_service = 0;
            };

            const collectFranchiseAreaIds = (franchiseDocs) => {
                const seen = new Set();
                const oids = [];
                for (const fr of franchiseDocs || []) {
                    if (!fr || fr.area_id == null) continue;
                    const arr = Array.isArray(fr.area_id) ? fr.area_id : [fr.area_id];
                    for (const item of arr) {
                        let oid = null;
                        if (item instanceof mongoose.Types.ObjectId) {
                            oid = item;
                        } else if (item && typeof item === 'object' && item._id) {
                            oid = item._id;
                        } else if (typeof item === 'string' && /^[a-fA-F0-9]{24}$/i.test(item.trim())) {
                            oid = new mongoose.Types.ObjectId(item.trim());
                        }
                        if (!oid) continue;
                        const k = oid.toString();
                        if (seen.has(k)) continue;
                        seen.add(k);
                        oids.push(oid);
                    }
                }
                return oids;
            };

            const callerType = Number(caller.type);
            let franchiseDocs = [];
            if (franchiseScopeOid) {
                const one = await Franchise.findOne({
                    _id: franchiseScopeOid,
                    deleted_at: null,
                })
                    .select('_id area_id')
                    .lean();
                franchiseDocs = one ? [one] : [];
            } else if (callerType === 1) {
                if (caller.franchise_id) {
                    const one = await Franchise.findOne({
                        _id: caller.franchise_id,
                        deleted_at: null,
                    })
                        .select('_id area_id')
                        .lean();
                    franchiseDocs = one ? [one] : [];
                } else {
                    franchiseDocs = await Franchise.find({
                        deleted_at: null,
                        admin_id: req.user.id,
                    })
                        .select('_id area_id')
                        .lean();
                }
            } else if (caller.franchise_id) {
                const one = await Franchise.findOne({
                    _id: caller.franchise_id,
                    deleted_at: null,
                })
                    .select('_id area_id')
                    .lean();
                if (one) franchiseDocs = [one];
            }
 
            if (franchiseDocs.length === 0) {
                setMyFranchiseZeros();
            } else {
                const franchiseIdsScope = franchiseDocs.map((f) => f._id);

                const employeeFilter = {
                    type: 3,
                    franchise_id: { $in: franchiseIdsScope },
                    deleted_at: null,
                };
                response.total_employee = await User.countDocuments(employeeFilter);
                response.inactive_employee = await User.countDocuments({
                    ...employeeFilter,
                    is_active: false,
                });
                response.active_employee = await User.countDocuments({
                    ...employeeFilter,
                    is_active: true,
                });

                const areaIds = collectFranchiseAreaIds(franchiseDocs);
                if (areaIds.length === 0) {
                    response.total_area = 0;
                    response.inactive_area = 0;
                    response.active_area = 0;
                } else {
                    const areaBase = { _id: { $in: areaIds }, deleted_at: null };
                    response.total_area = await Area.countDocuments(areaBase);
                    response.inactive_area = await Area.countDocuments({
                        ...areaBase,
                        is_active: false,
                    });
                    response.active_area = await Area.countDocuments({
                        ...areaBase,
                        is_active: { $ne: false },
                    });
                }

                Object.assign(
                    response,
                    await buildFranchiseDashboardCategoryServiceCountRecord(franchiseIdsScope),
                );
            }
        } else if (resolvedType === 11) {
            // Quote Management — same franchise/role scope as GET /api/quote/getCounts
            const { buildQuoteBucketFilter } = require('../enum/quote_status_enum');

            const franchiseQuery = franchiseScopeOid ? franchiseScopeOid.toString() : undefined;
            const scopeResult = await resolveQuoteListScope(req, {
                franchiseIdFromQuery: franchiseQuery,
            });
            if (!scopeResult.ok) {
                return res.status(scopeResult.status).json({
                    success: false,
                    status: scopeResult.status,
                    message: scopeResult.message,
                });
            }

            const baseFilter = { deleted_at: null, ...scopeResult.filter };

            const [newCount, pendingCount, acceptedCount, successCount, failedCount] =
                await Promise.all([
                    Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter('new') }),
                    Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter('pending') }),
                    Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter('accepted') }),
                    Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter('success') }),
                    Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter('failed') }),
                ]);

            response.new = newCount;
            response.pending = pendingCount;
            response.accepted = acceptedCount;
            response.success = successCount;
            response.failed = failedCount;
        } else if (resolvedType === 12) {
            // Partner Management — subscription plans & partner subscriptions (dashboard cards)
            const planBase = { deleted_at: null };
            response.total_plans = await SubscriptionPlan.countDocuments(planBase);
            response.active_plans = await SubscriptionPlan.countDocuments({ ...planBase, is_active: true });
            response.inactive_plans = await SubscriptionPlan.countDocuments({ ...planBase, is_active: false });

            const subBase = { deleted_at: null };
            if (franchiseScopeOid) {
                const partnerIds = await User.find({
                    type: 2,
                    franchise_id: franchiseScopeOid,
                    deleted_at: null,
                }).distinct('_id');
                if (partnerIds.length === 0) {
                    response.total_partner_subscriptions = 0;
                    response.active_partner_subscriptions = 0;
                    response.inactive_partner_subscriptions = 0;
                } else {
                    const scopedSub = { ...subBase, partner_id: { $in: partnerIds } };
                    response.total_partner_subscriptions = await PartnerSubscription.countDocuments(scopedSub);
                    response.active_partner_subscriptions = await PartnerSubscription.countDocuments({
                        ...scopedSub,
                        status: 'active',
                    });
                    response.inactive_partner_subscriptions = await PartnerSubscription.countDocuments({
                        ...scopedSub,
                        status: { $ne: 'active' },
                    });
                }
            } else {
                response.total_partner_subscriptions = await PartnerSubscription.countDocuments(subBase);
                response.active_partner_subscriptions = await PartnerSubscription.countDocuments({
                    ...subBase,
                    status: 'active',
                });
                response.inactive_partner_subscriptions = await PartnerSubscription.countDocuments({
                    ...subBase,
                    status: { $ne: 'active' },
                });
            }
        } else if (resolvedType === 13) {
            // Settings → Management roles: Franchise Admin (type 1), Franchise Employee (type 3), Staff (type 6); optional franchiseScope narrows all three
            const caller = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type franchise_id');
            if (!caller) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: 'User not found.',
                });
            }

            const CALLER_SUPER_ADMIN = 5;
            const CALLER_STAFF = 6;
            const CALLER_FRANCHISE_ADMIN = 1;
            const CALLER_EMPLOYEE = 3;
            const callerType = Number(caller.type);

            let franchiseScope = null;
            if (callerType === CALLER_SUPER_ADMIN || callerType === CALLER_STAFF) {
                if (franchiseScopeOid) {
                    franchiseScope = franchiseScopeOid;
                }
            } else if (callerType === CALLER_FRANCHISE_ADMIN || callerType === CALLER_EMPLOYEE) {
                if (!caller.franchise_id) {
                    response.total_franchise_admin = 0;
                    response.active_franchise_admin = 0;
                    response.inactive_franchise_admin = 0;
                    response.total_franchise_employee = 0;
                    response.active_franchise_employee = 0;
                    response.inactive_franchise_employee = 0;
                    response.total_staff = 0;
                    response.active_staff = 0;
                    response.inactive_staff = 0;
                    const body = buildGetCountSuccessBody(response);
                    return res.status(200).type('application/json').send(JSON.stringify(body));
                }
                franchiseScope = caller.franchise_id;
            } else {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: 'You are not allowed to access this count.',
                });
            }

            const base = { deleted_at: null };
            const franchiseMatch = franchiseScope ? { franchise_id: franchiseScope } : {};

            const franchiseAdminBase = {
                ...base,
                type: CALLER_FRANCHISE_ADMIN,
                ...franchiseMatch,
            };
            const franchiseEmployeeBase = {
                ...base,
                type: CALLER_EMPLOYEE,
                ...franchiseMatch,
            };
            const staffBase = {
                ...base,
                type: CALLER_STAFF,
                ...franchiseMatch,
            };

            response.total_franchise_admin = await User.countDocuments(franchiseAdminBase);
            response.active_franchise_admin = await User.countDocuments({
                ...franchiseAdminBase,
                is_active: true,
            });
            response.inactive_franchise_admin = await User.countDocuments({
                ...franchiseAdminBase,
                is_active: false,
            });

            response.total_franchise_employee = await User.countDocuments(franchiseEmployeeBase);
            response.active_franchise_employee = await User.countDocuments({
                ...franchiseEmployeeBase,
                is_active: true,
            });
            response.inactive_franchise_employee = await User.countDocuments({
                ...franchiseEmployeeBase,
                is_active: false,
            });

            response.total_staff = await User.countDocuments(staffBase);
            response.active_staff = await User.countDocuments({
                ...staffBase,
                is_active: true,
            });
            response.inactive_staff = await User.countDocuments({
                ...staffBase,
                is_active: false,
            });
        } else if (resolvedType === 14) {
            // Order Management — same franchise scope as GET /api/order/getAll
            const franchiseQuery = franchiseScopeOid ? franchiseScopeOid.toString() : undefined;
            const scopeResult = await resolveOrderListScope(req, {
                franchiseIdFromQuery: franchiseQuery,
            });
            if (!scopeResult.ok) {
                return res.status(scopeResult.status).json({
                    success: false,
                    status: scopeResult.status,
                    message: scopeResult.message,
                });
            }

            const orderBase = { deleted_at: null, ...scopeResult.filter };

            const [inProgress, completed, cancelled, refunded] = await Promise.all([
                Order.countDocuments({
                    ...orderBase,
                    ...buildOrderStatusQueryFilter(ORDER_STATUS_IN_PROGRESS),
                }),
                Order.countDocuments({
                    ...orderBase,
                    ...buildOrderStatusQueryFilter(ORDER_STATUS_COMPLETED),
                }),
                Order.countDocuments({
                    ...orderBase,
                    ...buildOrderStatusQueryFilter(ORDER_STATUS_CANCELLED),
                }),
                Order.countDocuments({
                    ...orderBase,
                    ...buildOrderStatusQueryFilter(ORDER_STATUS_REFUNDED),
                }),
            ]);

            response.in_progress = inProgress;
            response.completed = completed;
            response.cancelled = cancelled;
            response.refunded = refunded;
        } else if (resolvedType === 15) {
            // Settings → Offers (settings-offers page)
            const offerBase = { deleted_at: null };
            response.total_offer = await Offer.countDocuments(offerBase);
            response.active_offer = await Offer.countDocuments({ ...offerBase, is_active: true });
            response.inactive_offer = await Offer.countDocuments({ ...offerBase, is_active: false });
        }
        const body = buildGetCountSuccessBody(response);
        return res.status(200).type('application/json').send(JSON.stringify(body));
    } catch (error) {
        console.error('Error fetching Count data:', error);
        return res.status(500).json({
            success: false,
            status: 500,
            error: 'Internal Server Error'
        });
    }
};

const getServiceCountData = async (id) => {
    const user = await User.findById(id);
    if (!user) {
        throw new Error('User not found');
    }
    const filterCondition = user.type === 4 ? { user_id: id } : { partner_id: id };
    filterCondition.deleted_at = null;
    try {
        const amountField = user.type === 2 ? "$partner_earning" : "$total_price";
        const paid_field = user.type === 2 ? "$is_partner_paid" : "$is_paid";

        const result = await OrderService.aggregate([
            { $match: { ...filterCondition } },
            {
                $group: {
                    _id: null,
                    total_service: { $sum: 1 },
                    service_paid: { $sum: { $cond: [{ $eq: [paid_field, true] }, 1, 0] } },
                    service_unpaid: { $sum: { $cond: [{ $eq: [paid_field, false] }, 1, 0] } },
                    total_amount: { $sum: amountField },
                    pending_amount: {
                        $sum: { $cond: [{ $eq: [paid_field, false] }, amountField, 0] }
                    },
                    paid_amount: {
                        $sum: { $cond: [{ $eq: [paid_field, true] }, amountField, 0] }
                    },
                    in_progress_service: { $sum: { $cond: [{ $eq: ["$service_status", "in-progress"] }, 1, 0] } },
                    completed_service: { $sum: { $cond: [{ $eq: ["$service_status", "completed"] }, 1, 0] } },
                    cancelled_service: { $sum: { $cond: [{ $eq: ["$service_status", "cancelled"] }, 1, 0] } },
                    refunded_service: { $sum: { $cond: [{ $eq: ["$service_status", "refunded"] }, 1, 0] } }
                }
            },
            {
                $addFields: {
                    balance_amount: { $subtract: ["$total_amount", "$pending_amount"] }
                }
            }
        ]);
        let no_of_services = 0
        if (user.type === 2) {
            no_of_services = await PartnerService.countDocuments({ partner_id: id, deleted_at: null });
        }
        if (result.length > 0) {
            result[0].no_of_services = no_of_services;
            return result[0];
        } else {
            return {
                total_service: 0,
                service_paid: 0,
                service_unpaid: 0,
                total_amount: 0,
                pending_amount: 0,
                paid_amount: 0,
                balance_amount: 0,
                in_progress_service: 0,
                completed_service: 0,
                cancelled_service: 0,
                no_of_services: no_of_services,
            };
        }
    } catch (error) {
        console.error('Error fetching Count data:', error);
        throw error; // Rethrow the error for better handling
    }
};

const getVerificationCountData = async (id) => {
    try {
        const document_uploaded_count = await PartnerDocument.countDocuments({
            partner_id: id,
            document_image: { $ne: "" }, // Count only if document_image is not an empty string
            deleted_at: null
        });
        return document_uploaded_count;
    } catch (error) {
        console.error('Error fetching Count data:', error);
        throw error; // Rethrow the error for better handling
    }
};

const getPartnerServiceCount = async (req, res) => {
    try {

        const user_id = req.query.user_id;

        if (!user_id || user_id === undefined || user_id.trim() === '') {
            return res.status(400).json({
                success: false,
                status: 400,
                message: "Partner ID is required.",
            });
        }

        const partnerId = await checkObjectIdExists(User, user_id, 'partner');
        if (partnerId.exists === false) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: partnerId.message
            });
        }

        const pipeline = [
            {
                $match: {
                    partner_id: new mongoose.Types.ObjectId(user_id),
                    service_status: 'completed',
                    deleted_at: null,
                },
            },
            {
                $count: "total_complete_service"
            }
        ];

        const result = await OrderService.aggregate(pipeline);

        return res.status(200).json({
            success: true,
            status: 200,
            record: {
                total_complete_service: result[0]?.total_complete_service || 0
            }
        });
    } catch (error) {
        console.error("Error fetching partner service count:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

const getHomeCount = async (req, res) => {
    try {
        const result = {
            total_distance_travelled: 0,
            served: 0,
            consulted: 0,
            captured: 0,
        }

        return res.status(200).json({
            success: true,
            status: 200,
            record: result
        });
    } catch (error) {
        console.error("Error fetching partner service count:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};


module.exports = {
    getCountData,
    getServiceCountData,
    getVerificationCountData,
    getPartnerServiceCount,
    getHomeCount,
    buildVerificationListFranchiseFilter,
    pickFranchiseIdFromRequest,
};