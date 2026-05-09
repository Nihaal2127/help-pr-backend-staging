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
const Expense = require('../models/expense');
const ExpenseCategory = require('../models/expense_category');
const ContentManagement = require('../models/content_management');
const { checkObjectIdExists } = require('../validator/id_validator');
const moment = require("moment-timezone");

const resolveCountType = (type) => {
    if (typeof type === 'number') return type;
    if (typeof type !== 'string') return null;

    const trimmedType = type.trim();
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
        'partner-management': 5,
        'partner-payment': 5,
        'franchise-management': 6,
        'expenses': 7,
        'settings-expense-categories': 8,
        'content-management': 9,
    };

    return typeMap[key] ?? null;
};

const getCountData = async (req, res) => {
    try {
        const { type } = req.body;
        const resolvedType = resolveCountType(type);
        const response = {}
        if (resolvedType === 1) {
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

        } else if (resolvedType === 2) {
            // Service & Category
            const caller = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type franchise_id');
            if (!caller) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: 'User not found.',
                });
            }

            const categoryFilter = { deleted_at: null };
            const serviceFilter = { deleted_at: null };

            if (caller.type === 1) {
                if (!caller.franchise_id) {
                    categoryFilter.requested_by = { $in: [] };
                    serviceFilter.requested_by = { $in: [] };
                } else {
                    const franchiseUserIds = await User.find({
                        franchise_id: caller.franchise_id,
                        deleted_at: null,
                    }).distinct('_id');
                    categoryFilter.requested_by = { $in: franchiseUserIds };
                    serviceFilter.requested_by = { $in: franchiseUserIds };
                }
            }

            const total_category = await Category.countDocuments({ ...categoryFilter, is_request: false });
            const inactive_category = await Category.countDocuments({ ...categoryFilter, is_active: false, is_request: false });
            const active_category = await Category.countDocuments({ ...categoryFilter, is_active: true, is_request: false });
            const requested_category = await Category.countDocuments({ ...categoryFilter, is_request: true });

            const total_service = await Service.countDocuments({ ...serviceFilter, is_request: false });
            const inactive_service = await Service.countDocuments({ ...serviceFilter, is_active: false, is_request: false });
            const active_service = await Service.countDocuments({ ...serviceFilter, is_active: true, is_request: false });
            const requested_service = await Service.countDocuments({ ...serviceFilter, is_request: true });

            response.total_category = total_category;
            response.inactive_category = inactive_category;
            response.active_category = active_category;
            response.requested_category = requested_category;

            response.total_service = total_service;
            response.inactive_service = inactive_service;
            response.active_service = active_service;
            response.requested_service = requested_service;

        } else if (resolvedType === 3) {
            // Users & partner & Employee & Verifications -> Total,Verified,Pending,Rejected

            const total_user = await User.countDocuments({ type: 4, deleted_at: null });
            const inactive_user = await User.countDocuments({ type: 4, is_active: false, deleted_at: null });
            const active_user = await User.countDocuments({ type: 4, is_active: true, deleted_at: null });
            const blocked_user = await User.countDocuments({ type: 4, is_blocked: true, deleted_at: null });

            const total_employee = await User.countDocuments({ type: 3, deleted_at: null });
            const inactive_employee = await User.countDocuments({ type: 3, is_active: false, deleted_at: null });
            const active_employee = await User.countDocuments({ type: 3, is_active: true, deleted_at: null });

            const total_partner = await User.countDocuments({ type: 2, verification_status: 2, deleted_at: null });
            const inactive_partner = await User.countDocuments({ type: 2, verification_status: 2, is_active: false, deleted_at: null });
            const active_partner = await User.countDocuments({ type: 2, verification_status: 2, is_active: true, deleted_at: null });

            const total_document = await User.countDocuments({ type: 2, deleted_at: null });
            const pending_document = await User.countDocuments({ type: 2, verification_status: 1, deleted_at: null });
            const verified_document = await User.countDocuments({ type: 2, verification_status: 2, deleted_at: null });
            const reject_document = await User.countDocuments({ type: 2, verification_status: 3, deleted_at: null });

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
            const result = await Order.aggregate([
                {
                    $match: {
                        deleted_at: null,
                        order_status: 3
                    }
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
            }
        } else if (resolvedType === 5) {
            // Partner Payment
            const result = await OrderService.aggregate([
                {
                    $match: {
                        deleted_at: null,
                        service_status: 3
                    }
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
            if (caller.type === 1) {
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
            if (caller.type === 1) {
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
            if (caller.type === 1) {
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
        }
        return res.status(200).json({
            success: true,
            status: 200,
            record: response,
        });
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