const mongoose = require('mongoose');
const State = require('../models/state');
const City = require('../models/city');
const Area = require('../models/area');
const User = require('../models/user');
const PartnerDocument = require('../models/partner_document');
const Category = require('../models/category');
const Service = require('../models/service');
const OrderService = require('../models/order_services');
const Order = require('../models/order');
const PartnerService = require('../models/partner_service');
const Franchise = require('../models/franchise');
const FranchiseCategory = require('../models/franchise_category');
const FranchiseService = require('../models/franchise_service');
const Expense = require('../models/expense');
const ExpenseCategory = require('../models/expense_category');
const ContentManagement = require('../models/content_management');
const Quote = require('../models/quote');
const SubscriptionPlan = require('../models/subscription_plan');
const PartnerSubscription = require('../models/partner_subscription');
const { checkObjectIdExists } = require('../validator/id_validator');
const moment = require("moment-timezone");

/**
 * Optional franchise scope from JSON body: `franchise` (preferred) or `franchise_id`.
 * When present, must be a valid 24-char ObjectId.
 */
const parseOptionalFranchiseFromBody = (req) => {
    const rawPrimary = req.body?.franchise;
    const rawAlt = req.body?.franchise_id;
    const pick =
        rawPrimary !== undefined && rawPrimary !== null && String(rawPrimary).trim() !== ''
            ? rawPrimary
            : rawAlt !== undefined && rawAlt !== null && String(rawAlt).trim() !== ''
              ? rawAlt
              : null;
    if (pick === null) {
        return { ok: true, oid: null };
    }
    const s = String(pick).trim();
    if (!mongoose.Types.ObjectId.isValid(s)) {
        return { ok: false, status: 409, message: 'Invalid franchise id.' };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(s) };
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
        order_status: 3,
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
 * Category/service counts aligned with my-franchise: global catalogue totals, mapping-based active slots,
 * requested rows from users on the given franchise(s).
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

    const franchiseUserIds = await User.find({
        franchise_id: { $in: franchiseIdsScope },
        deleted_at: null,
    }).distinct('_id');

    out.total_category = await Category.countDocuments({ deleted_at: null });
    out.total_service = await Service.countDocuments({ deleted_at: null });

    const franchiseCategoryDocs = await FranchiseCategory.find({
        franchise_id: { $in: franchiseIdsScope },
        deleted_at: null,
    })
        .select('active_categories')
        .lean();

    let activeCategorySlots = 0;
    for (const row of franchiseCategoryDocs) {
        activeCategorySlots += (row.active_categories || []).length;
    }
    out.active_category = activeCategorySlots;
    out.inactive_category = Math.max(0, out.total_category - activeCategorySlots);

    const franchiseServiceDocs = await FranchiseService.find({
        franchise_id: { $in: franchiseIdsScope },
        deleted_at: null,
    })
        .select('active_services')
        .lean();

    let activeServiceSlots = 0;
    for (const row of franchiseServiceDocs) {
        activeServiceSlots += (row.active_services || []).length;
    }
    out.active_service = activeServiceSlots;
    out.inactive_service = Math.max(0, out.total_service - activeServiceSlots);

    out.requested_category = await Category.countDocuments({
        deleted_at: null,
        is_request: true,
        requested_by: { $in: franchiseUserIds },
    });
    out.requested_service = await Service.countDocuments({
        deleted_at: null,
        is_request: true,
        requested_by: { $in: franchiseUserIds },
    });

    return out;
};

const getCountData = async (req, res) => {
    try {
        const { type } = req.body;
        const resolvedType = resolveCountType(type);
        if (resolvedType === null || resolvedType === undefined) {
            return res.status(400).json({
                success: false,
                status: 400,
                message:
                    'Invalid or unsupported count type. Send JSON body with "type" (e.g. "settings-role", "location-management", or a supported numeric code).',
            });
        }

        const parsedFranchise = parseOptionalFranchiseFromBody(req);
        if (!parsedFranchise.ok) {
            return res.status(parsedFranchise.status).json({
                success: false,
                status: parsedFranchise.status,
                message: parsedFranchise.message,
            });
        }
        const franchiseScopeOid = parsedFranchise.oid;
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
            // Service & category: same category/service semantics as my-franchise when franchise is in the body;
            // global Category/Service counts when neither franchise nor franchise_id is sent ("all").
            if (franchiseScopeOid) {
                Object.assign(
                    response,
                    await buildFranchiseDashboardCategoryServiceCountRecord([franchiseScopeOid]),
                );
            } else {
                Object.assign(response, await buildGlobalCategoryServiceCountRecord());
            }

        } else if (resolvedType === 3) {
            // Users & partner & Employee & Verifications -> Total,Verified,Pending,Rejected
            const userFr = franchiseScopeOid ? { franchise_id: franchiseScopeOid } : {};

            const total_user = await User.countDocuments({ type: 4, deleted_at: null, ...userFr });
            const inactive_user = await User.countDocuments({ type: 4, is_active: false, deleted_at: null, ...userFr });
            const active_user = await User.countDocuments({ type: 4, is_active: true, deleted_at: null, ...userFr });
            const blocked_user = await User.countDocuments({ type: 4, is_blocked: true, deleted_at: null, ...userFr });

            const total_employee = await User.countDocuments({ type: 3, deleted_at: null, ...userFr });
            const inactive_employee = await User.countDocuments({ type: 3, is_active: false, deleted_at: null, ...userFr });
            const active_employee = await User.countDocuments({ type: 3, is_active: true, deleted_at: null, ...userFr });

            const total_partner = await User.countDocuments({ type: 2, verification_status: 2, deleted_at: null, ...userFr });
            const inactive_partner = await User.countDocuments({ type: 2, verification_status: 2, is_active: false, deleted_at: null, ...userFr });
            const active_partner = await User.countDocuments({ type: 2, verification_status: 2, is_active: true, deleted_at: null, ...userFr });

            const total_document = await User.countDocuments({ type: 2, deleted_at: null, ...userFr });
            const pending_document = await User.countDocuments({ type: 2, verification_status: 1, deleted_at: null, ...userFr });
            const verified_document = await User.countDocuments({ type: 2, verification_status: 2, deleted_at: null, ...userFr });
            const reject_document = await User.countDocuments({ type: 2, verification_status: 3, deleted_at: null, ...userFr });

            response.total_user = total_user;
            response.inactive_user = inactive_user;
            response.active_user = active_user;
            response.blocked_user = blocked_user;

            response.total_employee = total_employee;
            response.inactive_employee = inactive_employee;
            response.active_employee = active_employee;

            response.total_partner = total_partner;
            response.inactive_partner = inactive_partner;
            response.active_partner = active_partner;

            response.total_document = total_document;
            response.pending_document = pending_document;
            response.verified_document = verified_document;
            response.reject_document = reject_document;
        } else if (resolvedType === 4) {
            // Order Payment
            const orderMatch = {
                deleted_at: null,
                order_status: 3,
                ...(franchiseScopeOid ? { _id: { $in: await buildFranchiseScopedCompletedOrderIds(franchiseScopeOid) } } : {}),
            };
            const result = await Order.aggregate([
                {
                    $match: orderMatch,
                },
                {
                    $group: {
                        _id: null,
                        received_amount: { $sum: { $cond: [{ $eq: ["$is_paid", true] }, "$total_price", 0] } },
                        pending_amount: { $sum: { $cond: [{ $eq: ["$is_paid", false] }, "$total_price", 0] } },
                    }
                },
            ]);
            if (result.length > 0) {
                const data = result[0];
                response.received_amount = data.received_amount;
                response.pending_amount = data.pending_amount;
            } else {
                response.received_amount = 0;
                response.pending_amount = 0;
            }
        } else if (resolvedType === 5) {
            // Partner Payment
            const osMatch = {
                deleted_at: null,
                service_status: 3,
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
            // Quote Management
            const { buildQuoteBucketFilter } = require('../enum/quote_status_enum');

            const baseFilter = { deleted_at: null };
            if (franchiseScopeOid) {
                baseFilter.franchise_id = franchiseScopeOid;
            }

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
                    in_progress_service: { $sum: { $cond: [{ $eq: ["$service_status", 2] }, 1, 0] } },
                    completed_service: { $sum: { $cond: [{ $eq: ["$service_status", 3] }, 1, 0] } },
                    cancelled_service: { $sum: { $cond: [{ $eq: ["$service_status", 4] }, 1, 0] } }
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
                    service_status: 3,
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


module.exports = { getCountData, getServiceCountData, getVerificationCountData, getPartnerServiceCount, getHomeCount };