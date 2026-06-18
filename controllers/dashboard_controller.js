const User = require('../models/user');
const Service = require('../models/service');
const Order = require('../models/order');
const { buildAdminDashboardStats } = require('../services/admin_dashboard_stats_service');



const getDashboardDataOld = async (req, res) => {
    try {
        const response = {}
        
        const total_service = await Service.countDocuments({ deleted_at: null });
        const inactive_service = await Service.countDocuments({ is_active: false, deleted_at: null });
        const active_service = await Service.countDocuments({ is_active: true, deleted_at: null });



        response.total_service = total_service;
        response.inactive_service = inactive_service;
        response.active_service = active_service;



        const total_partner = await User.countDocuments({ type: 2, deleted_at: null });
        const inactive_partner = await User.countDocuments({ type: 2, is_active: false, deleted_at: null });
        const active_partner = await User.countDocuments({ type: 2, is_active: true, deleted_at: null });



        response.total_partner = total_partner;
        response.inactive_partner = inactive_partner;
        response.active_partner = active_partner;



        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);

        const resultTodaysOrder = await Order.aggregate([
            {
                $match: {
                    deleted_at: null,
                    created_at: { $gte: startOfToday, $lte: endOfToday }
                }
            },
            {
                $group: {
                    _id: null,
                    pending_order: {
                        $sum: { $cond: [{ $eq: [1, 0] }, 1, 0] },
                    },
                    in_progress_order: {
                        $sum: { $cond: [{ $eq: ["$order_status", "in-progress"] }, 1, 0] }
                    },
                    completed_order: {
                        $sum: { $cond: [{ $eq: ["$order_status", "completed"] }, 1, 0] }
                    },
                    cancelled_order: {
                        $sum: { $cond: [{ $eq: ["$order_status", "cancelled"] }, 1, 0] }
                    },
                    refunded_order: {
                        $sum: { $cond: [{ $eq: ["$order_status", "refunded"] }, 1, 0] }
                    },
                    received_amount: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$order_status", "completed"] }, { $eq: ["$is_paid", true] }] },
                                "$total_price",
                                0
                            ]
                        }
                    },
                    pending_amount: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$order_status", "completed"] }, { $eq: ["$is_paid", false] }] },
                                "$total_price",
                                0
                            ]
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    pending_order: 1,
                    in_progress_order: 1,
                    completed_order: 1,
                    cancelled_order: 1,
                    refunded_order: 1,
                    received_amount: 1,
                    pending_amount: 1
                }
            }
        ]);
        const summaryTodaysOrder = resultTodaysOrder[0] || {
            pending_order: 0,
            in_progress_order: 0,
            completed_order: 0,
            cancelled_order: 0,
            refunded_order: 0,
            received_amount: 0,
            pending_amount: 0
        };

        response.pending_order = summaryTodaysOrder.pending_order;
        response.in_progress_order = summaryTodaysOrder.in_progress_order;
        response.completed_order = summaryTodaysOrder.completed_order;
        response.cancelled_order = summaryTodaysOrder.cancelled_order;
        response.refunded_order = summaryTodaysOrder.refunded_order;
        response.received_amount = summaryTodaysOrder.received_amount;
        response.pending_amount = summaryTodaysOrder.pending_amount;

        const resultTotalRevenue = await Order.aggregate([
            {
                $match: {
                    deleted_at: null,
                    order_status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    total_admin_earning: { $sum: "$admin_earning" }
                }
            },
            {
                $project: {
                    _id: 0,
                    total_admin_earning: 1
                }
            }
        ]);
        const summaryTotalRevenue = resultTotalRevenue[0] || {
            total_admin_earning: 0,
        };
        response.revenue = summaryTotalRevenue.total_admin_earning;
        console.log('summaryTodaysOrder', summaryTodaysOrder);
        console.log('resultTotalRevenue', summaryTotalRevenue);

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

const getDashboardData = async (req, res) => {
    try {
        const response = {};

        // 1. Handle ISO 8601 Date (e.g., 2025-06-16T06:49:15.666Z)
        const inputDate = req.query.date;
        let startOfDay = new Date();
        let endOfDay = new Date();

        if (inputDate) {
            const parsedDate = new Date(inputDate);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    error: 'Invalid date format. Use a valid ISO string.',
                });
            }

            startOfDay = new Date(parsedDate);
            startOfDay.setHours(0, 0, 0, 0);

            endOfDay = new Date(parsedDate);
            endOfDay.setHours(23, 59, 59, 999);
        } else {
            startOfDay.setHours(0, 0, 0, 0);
            endOfDay.setHours(23, 59, 59, 999);
        }
        
        
        const total_service = await Service.countDocuments({ deleted_at: null });
        const inactive_service = await Service.countDocuments({ is_active: false, deleted_at: null });
        const active_service = await Service.countDocuments({ is_active: true, deleted_at: null });

        response.total_service = total_service;
        response.inactive_service = inactive_service;
        response.active_service = active_service;

        
        const total_partner = await User.countDocuments({ type: 2, deleted_at: null });
        const inactive_partner = await User.countDocuments({ type: 2, is_active: false, deleted_at: null });
        const active_partner = await User.countDocuments({ type: 2, is_active: true, deleted_at: null });

        response.total_partner = total_partner;
        response.inactive_partner = inactive_partner;
        response.active_partner = active_partner;

        
        const resultTodaysOrder = await Order.aggregate([
            {
                $match: {
                    deleted_at: null,
                    created_at: { $gte: startOfDay, $lte: endOfDay }
                }
            },
            {
                $group: {
                    _id: null,
                    pending_order: {
                        $sum: { $cond: [{ $eq: [1, 0] }, 1, 0] },
                    },
                    in_progress_order: {
                        $sum: { $cond: [{ $eq: ["$order_status", "in-progress"] }, 1, 0] }
                    },
                    completed_order: {
                        $sum: { $cond: [{ $eq: ["$order_status", "completed"] }, 1, 0] }
                    },
                    cancelled_order: {
                        $sum: { $cond: [{ $eq: ["$order_status", "cancelled"] }, 1, 0] }
                    },
                    refunded_order: {
                        $sum: { $cond: [{ $eq: ["$order_status", "refunded"] }, 1, 0] }
                    },
                    received_amount: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$order_status", "completed"] }, { $eq: ["$is_paid", true] }] },
                                "$total_price",
                                0
                            ]
                        }
                    },
                    pending_amount: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$order_status", "completed"] }, { $eq: ["$is_paid", false] }] },
                                "$total_price",
                                0
                            ]
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    pending_order: 1,
                    in_progress_order: 1,
                    completed_order: 1,
                    cancelled_order: 1,
                    refunded_order: 1,
                    received_amount: 1,
                    pending_amount: 1
                }
            }
        ]);

        const summaryTodaysOrder = resultTodaysOrder[0] || {
            pending_order: 0,
            in_progress_order: 0,
            completed_order: 0,
            cancelled_order: 0,
            refunded_order: 0,
            received_amount: 0,
            pending_amount: 0
        };

        response.pending_order = summaryTodaysOrder.pending_order;
        response.in_progress_order = summaryTodaysOrder.in_progress_order;
        response.completed_order = summaryTodaysOrder.completed_order;
        response.cancelled_order = summaryTodaysOrder.cancelled_order;
        response.refunded_order = summaryTodaysOrder.refunded_order;
        response.received_amount = summaryTodaysOrder.received_amount;
        response.pending_amount = summaryTodaysOrder.pending_amount;

        const resultTotalRevenue = await Order.aggregate([
            {
                $match: {
                    deleted_at: null,
                    order_status: 'completed',
                    created_at: { $gte: startOfDay, $lte: endOfDay }
                }
            },
            {
                $group: {
                    _id: null,
                    total_admin_earning: { $sum: "$admin_earning" }
                }
            },
            {
                $project: {
                    _id: 0,
                    total_admin_earning: 1
                }
            }
        ]);

        const summaryTotalRevenue = resultTotalRevenue[0] || {
            total_admin_earning: 0,
        };

        response.revenue = summaryTotalRevenue.total_admin_earning;

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


const getAdminDashboardStats = async (req, res) => {
    try {
        const result = await buildAdminDashboardStats(req);
        if (!result.ok) {
            return res.status(result.status).json({
                success: false,
                status: result.status,
                message: result.message,
            });
        }

        return res.status(200).json({
            success: true,
            status: 200,
            record: result.data,
        });
    } catch (error) {
        console.error('Error fetching admin dashboard stats:', error);
        return res.status(500).json({
            success: false,
            status: 500,
            error: 'Internal Server Error',
        });
    }
};

module.exports = { getDashboardData, getAdminDashboardStats };