const mongoose = require("mongoose");
const State = require('../models/state');
const City = require('../models/city');
const Area = require('../models/area');
const Franchise = require('../models/franchise');
const Category = require('../models/category');
const Service = require('../models/service');
const User = require('../models/user');
const Order = require('../models/order');
const OrderService = require('../models/order_services');
const Ticket = require('../models/ticket');
const createExcel = require('../utils/createExcel');
const { getUserType } = require('../enum/user_type_enum');
const { getOrderStatus } = require('../enum/order_status_enum');
const { getPartnerPaymentStatus } = require('../enum/partner_payment_status_enum');
const { getResolveStatus } = require('../enum/ticket_resolve_status_enum');


const exportState = async (req, res) => {
    try {
        const states = await State.find({ deleted_at: null });
        result = states.map(state => ({
            name: state.name,
            status: state.is_active === true ? 'Active' : 'Inactive',
        }));

        const headers = ['Name', 'Status'];
        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: result,
            sheetName: `State Report`,
            fileName: `State.xlsx`,
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
}

const exportCity = async (req, res) => {
    try {

        const cities = await City.aggregate([
            {
                $match: {
                    deleted_at: null,
                },
            },
            {
                $lookup: {
                    from: 'states',
                    localField: 'state_id',
                    foreignField: '_id',
                    as: 'state',
                },
            },
            {
                $project: {
                    city_name: '$name',
                    state_name: { $arrayElemAt: ['$state.name', 0] },
                    city_service_price: '$city_service_price',
                    status: {
                        $cond: { if: { $eq: ['$is_active', true] }, then: 'Active', else: 'Inactive' },
                    },
                },
            },
        ]);

        const headers = [
            'State Name',
            'City Name',
            'City Service Price',
            'Status',
        ];


        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: cities,
            sheetName: 'City Report',
            fileName: `City.xlsx`,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

const exportArea = async (req, res) => {
    try {
        const areas = await Area.find({ deleted_at: null }).lean();
        const cityIds = [...new Set(areas.map((a) => a.city_id.toString()))].map(
            (id) => new mongoose.Types.ObjectId(id)
        );
        const cities = await City.find({ _id: { $in: cityIds } })
            .select('name')
            .lean();
        const cityMap = new Map(cities.map((c) => [c._id.toString(), c.name]));

        const result = areas.map((a) => ({
            state_name: a.state_name,
            city_name: cityMap.get(a.city_id.toString()) || '',
            area_name: a.name,
            pincodes:
                Array.isArray(a.pincodes) && a.pincodes.length
                    ? a.pincodes.join(', ')
                    : '',
            status: a.is_active === true ? 'Active' : 'Inactive',
        }));

        const headers = ['State Name', 'City Name', 'Area Name', 'Pincodes', 'Status'];
        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: result,
            sheetName: 'Area Report',
            fileName: `Area.xlsx`,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

const exportFranchise = async (req, res) => {
    try {
        const rows = await Franchise.find({ deleted_at: null }).lean();
        const result = rows.map((f) => ({
            name: f.name,
            state_name: f.state_name,
            city_name: f.city_name,
            areas: Array.isArray(f.area_name) && f.area_name.length ? f.area_name.join(', ') : '',
            admin_name: f.admin_name,
            contact: f.contact,
            description: f.description,
            desc: f.desc || '',
            desc2: f.desc2 || '',
            status: f.is_active === true ? 'Active' : 'Inactive',
        }));

        const headers = [
            'Franchise Name',
            'State',
            'City',
            'Areas',
            'Admin',
            'Contact',
            'Description',
            'Desc (legacy)',
            'Desc2',
            'Status',
        ];
        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: result,
            sheetName: 'Franchise Report',
            fileName: `Franchise.xlsx`,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

const exportCategory = async (req, res) => {
    try {
        const categories = await Category.find({ deleted_at: null });
        result = categories.map(category => ({
            category_name: category.name,
            description: category.desc,
            category_id: category.category_id,
            services: category.services,
            helpers: category.helpers,
            status: category.is_active === true ? 'Active' : 'Inactive',
        }));

        const headers = [
            'Category ID',
            'Category Name',
            'Description',
            'Services',
            'Helpers',
            'Status'];
        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: result,
            sheetName: `Category Report`,
            fileName: `Category.xlsx`,
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
}

const exportService = async (req, res) => {
    try {

        const services = await Service.aggregate([
            {
                $match: {
                    deleted_at: null,
                },
            },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'category_id',
                    foreignField: '_id',
                    as: 'category',
                },
            },
            {
                $project: {
                    service_id: '$service_id',
                    service_name: '$name',
                    description: '$desc',
                    category: { $arrayElemAt: ['$category.name', 0] },
                    city_service_price: '$city_service_price',
                    price: '$price',
                    helpers: '$helpers',
                    status: {
                        $cond: { if: { $eq: ['$is_active', true] }, then: 'Active', else: 'Inactive' },
                    },
                },
            },
        ]);

        const headers = [
            'Service ID',
            'Service Name',
            'Description',
            'Category',
            'Price',
            'Helpers',
            'Status',
        ];


        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: services,
            sheetName: 'Service Report',
            fileName: `Service.xlsx`,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

const exportUserList = async (req, res) => {
    const type = req.body.type;
    try {
        const users = await User.find({ deleted_at: null, type: type });
        result = users.map(user => ({
            user_id: user.user_id,
            user_name: user.name,
            phone_number: user.phone_number,
            email: user.email,
            start_date: user.created_at,
            status: user.is_active === true ? 'Active' : 'Inactive',
        }));

        const headers = [
            'User ID',
            'User Name',
            'Phone Number',
            'Email',
            'Start Date',
            'Status'];
        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: result,
            sheetName: `${getUserType(type)} Role Report`,
            fileName: `${getUserType(type)}_Role.xlsx`,
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
}

const exportOrders = async (req, res) => {
    try {
        const order_status = req.body.order_status;
        const orders = await Order.aggregate([
            {
                $match: {
                    deleted_at: null,
                    order_status: order_status
                },
            },
            {
                $lookup: {
                    from: 'cities',
                    localField: 'city_id',
                    foreignField: '_id',
                    as: 'city',
                },
            },
            {
                $project: {
                    order_id: '$unique_id',
                    user_id: '$user_unique_id',
                    order_date: '$order_date',
                    total_price: '$total_price',
                    location: { $arrayElemAt: ['$city.name', 0] },
                    payment_mode: {
                        $cond: { if: { $eq: ['$payment_mode_id', "2"] }, then: 'Online', else: 'COD' },
                    },
                },
            },
        ]);

        const headers = [
            'Order ID',
            'User ID',
            'Order Date',
            'Total Price',
            'Location',
            'Payment Mode',
        ];


        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: orders,
            sheetName: `${getOrderStatus(order_status)} Report`,
            fileName: `${getOrderStatus(order_status)}_Orders.xlsx`,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

const exportOrderPayments = async (req, res) => {
    try {
        const is_paid = req.body.is_paid;
        const orderServices = await OrderService.aggregate([
            {
                $match: {
                    deleted_at: null,
                    service_status: 3,
                    is_paid: is_paid,
                },
            },
            {
                $lookup: {
                    from: 'services',
                    localField: 'service_id',
                    foreignField: '_id',
                    as: 'service',
                },
            },
            {
                $project: {
                    order_id: '$order_unique_id',
                    partner_id: '$partner_unique_id',
                    user_id: '$user_unique_id',
                    service_name: { $arrayElemAt: ['$service.name', 0] },
                    service_date: '$service_date',
                    from_time: {
                        $dateToString: { format: '%H:%M', date: '$service_from_time' }
                    },
                    to_time: {
                        $dateToString: { format: '%H:%M', date: '$service_to_time' }
                    },
                    total_price: '$total_price',
                    payment_mode: {
                        $cond: { if: { $eq: ['$payment_mode_id', "2"] }, then: 'Online', else: 'COD' },
                    },
                },
            },
        ]);

        const headers = [
            'Order ID',
            'Partner ID',
            'User ID',
            'Service Name',
            'Service Date',
            'From Time',
            'To Time',
            'Total Price',
            'Payment Mode',
        ];


        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: orderServices,
            sheetName: `Order Payments ${is_paid === true ? 'Recived' : 'Pending'} Report`,
            fileName: `Order_Payments_${is_paid === true ? 'Recived' : 'Pending'}.xlsx`,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

const exportPartnerPayments = async (req, res) => {
    try {
        const partner_paid_status = req.body.partner_paid_status;
        const orderServices = await OrderService.aggregate([
            {
                $match: {
                    deleted_at: null,
                    service_status: 3,
                    partner_paid_status: partner_paid_status,
                },
            },
            {
                $lookup: {
                    from: 'services',
                    localField: 'service_id',
                    foreignField: '_id',
                    as: 'service',
                },
            },
            {
                $project: {
                    order_id: '$order_unique_id',
                    partner_id: '$partner_unique_id',
                    service_name: { $arrayElemAt: ['$service.name', 0] },
                    service_date: '$service_date',
                    total_amount: '$total_price',
                    partner_earning: '$partner_earning',
                },
            },
        ]);

        const headers = [
            'Order ID',
            'Partner ID',
            'Service Name',
            'Service Date',
            'Total Amount',
            'Partner Earning',
        ];


        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: orderServices,
            sheetName: `Partner Payments ${getPartnerPaymentStatus(partner_paid_status)} Report`,
            fileName: `Partner_Payments_${getPartnerPaymentStatus(partner_paid_status)}.xlsx`,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

const exportUserServices = async (req, res) => {
    try {
        const {
            service_status,
            user_id } = req.body;
        const userObjectId = new mongoose.Types.ObjectId(user_id);
        const user = await User.findById(userObjectId);

        const matchStage = {
            deleted_at: null,
        };
        if (user.type === 4) {
            matchStage.user_id = userObjectId;
        } else {
            matchStage.partner_id = userObjectId;
        }
        if (service_status !== 0) {
            matchStage.service_status = service_status;
        }

        const orderServices = await OrderService.aggregate([
            {
                $match: matchStage,
            },
            {
                $lookup: {
                    from: 'services',
                    localField: 'service_id',
                    foreignField: '_id',
                    as: 'service',
                },
            },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'category_id',
                    foreignField: '_id',
                    as: 'category',
                },
            },
            {
                $project: {
                    order_id: '$order_unique_id',
                    service_id: { $arrayElemAt: ['$service.name', 0] },
                    service_name: { $arrayElemAt: ['$service.name', 0] },
                    category: { $arrayElemAt: ['$category.name', 0] },
                    service_date: '$service_date',
                    amount: user.type === 4 ? '$total_price' : '$partner_earning',
                    partner_earning: '$partner_earning',
                    payment_status: {
                        $cond: { if: { $eq: ['$is_paid', true] }, then: 'Paid', else: 'Unpaid' },
                    },
                    pay_mode: {
                        $cond: { if: { $eq: ['$payment_mode_id', "2"] }, then: 'Online', else: 'COD' },
                    },
                    transaction_id: '$transaction_id',
                    ...(service_status === 0 && {
                        service_status: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$service_status', 1] }, then: 'Pending' },
                                    { case: { $eq: ['$service_status', 2] }, then: 'In-Progress' },
                                    { case: { $eq: ['$service_status', 3] }, then: 'Completed' },
                                    { case: { $eq: ['$service_status', 4] }, then: 'Cancelled' },
                                ],
                                default: 'Unknown',
                            },
                        }
                    }),
                },
            },
        ]);

        const headers = [
            'Order ID',
            'Service ID',
            'Service Name',
            'Category',
            'Service Date',
            'Amount',
            'Payment Status',
            'Pay Mode',
            'Transaction ID',
            ...(service_status === 0 ? ['Service Status'] : []),
        ];

        console.log('orderServices', orderServices);
        console.log('orderServices', matchStage);
        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: orderServices,
            sheetName: `${user.name} ${service_status === 0 ? '' : getOrderStatus(service_status)} Service Report`,
            fileName: `${user.user_id}${service_status === 0 ? '' : `_${getOrderStatus(service_status)}`}_Service.xlsx`,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

const exportTicket = async (req, res) => {
    try {
        const tickets = await Ticket.find({ deleted_at: null });
        result = tickets.map(ticket => ({
            ticket_id: ticket.unique_id,
            query: ticket.query,
            user_id: ticket.user_unique_id,
            created_name: ticket.created_by_name,
            resolved_name: ticket.resolved_by_name,
            close_date: ticket.close_date,
            resolve_status: getResolveStatus(ticket.resolve_status),
            contact_type: ticket.contact_type === 1 ? 'Mail' : 'Call',
            status: ticket.status === 1 ? 'Open' : 'Close',
            created_date: ticket.created_at,
        }));

        const headers = [
            'Ticket ID',
            'Query',
            'User ID',
            'Created Name',
            'Resolved Name',
            'Close Date',
            'Resolve Status',
            'Contact Type',
            'Status',
            'Created Date'
        ];
        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: result,
            sheetName: `Ticket Report`,
            fileName: `Ticket.xlsx`,
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
}

const exportVerification = async (req, res) => {
    try {

        const verifications = await User.aggregate([
            {
                $match: {
                    deleted_at: null,
                    type: 2
                },
            },

            {
                $lookup: {
                    from: 'users',
                    localField: 'created_by_id',
                    foreignField: '_id',
                    as: 'user',
                },
            },
            {
                $lookup: {
                    from: 'cities',
                    localField: 'city_id',
                    foreignField: '_id',
                    as: 'city',
                },
            },
            {
                $lookup: {
                    from: 'partner_documents',
                    localField: '_id',
                    foreignField: 'partner_id',
                    as: 'uploaded_documents',
                },
            },
            {
                $addFields: {
                    documents_uploaded: { $size: '$uploaded_documents' }
                },
            },
            {
                $project: {
                    registration_id: '$registration_id',
                    verification_id: '$verification_id',
                    submitted_name: { $arrayElemAt: ['$user.name', 0] },
                    submitted_date: '$submitted_at',
                    documents_uploaded: 1,
                    location: { $arrayElemAt: ['$city.name', 0] },
                    verified_date: '$verified_at',
                    status: {
                        $cond: { if: { $eq: ['$is_active', true] }, then: 'Active', else: 'Inactive' },
                    },
                },
            },
        ]);

        const headers = [
            'Registration ID',
            'Verification ID',
            'Submitted Name',
            'Submitted Date',
            'Documents Uploaded',
            'Location',
            'Verified Date',
            'Status',
        ];


        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: verifications,
            sheetName: 'Verification Report',
            fileName: `Verification.xlsx`,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

const exportUser = async (req, res) => {
    try {

        const verifications = await User.aggregate([
            {
                $match: {
                    deleted_at: null,
                    type: 4
                },
            },
            {
                $lookup: {
                    from: 'order_services',
                    localField: '_id',
                    foreignField: 'user_id',
                    as: 'order_service',
                },
            },
            {
                $addFields: {
                    service_taken: { $size: '$order_service' },
                    total_amount: {
                        $sum: '$order_service.total_price'
                    },
                    service_paid: {
                        $size: {
                            $filter: {
                                input: '$order_service',
                                as: 'os',
                                cond: { $eq: ['$$os.is_paid', true] }
                            }
                        }
                    },
                    service_unpaid: {
                        $size: {
                            $filter: {
                                input: '$order_service',
                                as: 'os',
                                cond: { $eq: ['$$os.is_paid', false] }
                            }
                        }
                    },
                    pending_amount: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: '$order_service',
                                        as: 'os',
                                        cond: { $eq: ['$$os.is_paid', false] }
                                    }
                                },
                                as: 'unpaid',
                                in: '$$unpaid.total_price'
                            }
                        }
                    },
                },
            },
            {
                $addFields: {
                    balance_amount: {
                        $subtract: ['$total_amount', '$pending_amount']
                    }
                }
            },
            {
                $project: {
                    user_id: '$user_id',
                    user_name: '$name',
                    service_taken: 1,
                    service_paid: 1,
                    service_unpaid: 1,
                    total_amount: 1,
                    balance_amount: 1,
                    status: {
                        $cond: { if: { $eq: ['$is_active', true] }, then: 'Active', else: 'Inactive' },
                    },
                },
            },
        ]);

        const headers = [
            'User ID',
            'User Name',
            'Service Taken',
            'Service Paid',
            'Service Unpaid',
            'Total Amount',
            'Balance Amount',
            'Status',
        ];


        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: verifications,
            sheetName: 'User Report',
            fileName: `User.xlsx`,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(process.env.NODE_ENV === 'production' ? fileBuffer.toString('base64') : fileBuffer);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

const exportPartner = async (req, res) => {
    try {
        const verifications = await User.aggregate([
            {
                $match: {
                    deleted_at: null,
                    type: 2
                }
            },
            {
                $lookup: {
                    from: 'partner_services',
                    localField: '_id',
                    foreignField: 'partner_id',
                    as: 'partner_service'
                }
            },
            {
                $addFields: {
                    no_of_services: { $size: '$partner_service' }
                }
            },
            {
                $lookup: {
                    from: 'order_services',
                    localField: '_id',
                    foreignField: 'partner_id',
                    as: 'order_service'
                }
            },
            {
                $addFields: {
                    service_provided: { $size: '$order_service' },
                    total_earnings: { $sum: '$order_service.partner_earning' },
                    service_paid: {
                        $size: {
                            $filter: {
                                input: '$order_service',
                                as: 'os',
                                cond: { $eq: ['$$os.partner_paid_status', 2] }
                            }
                        }
                    },
                    service_unpaid: {
                        $size: {
                            $filter: {
                                input: '$order_service',
                                as: 'os',
                                cond: { $eq: ['$$os.partner_paid_status', 1] }
                            }
                        }
                    },
                    service_return: {
                        $size: {
                            $filter: {
                                input: '$order_service',
                                as: 'os',
                                cond: { $eq: ['$$os.partner_paid_status', 3] }
                            }
                        }
                    },
                    bal_payment: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: '$order_service',
                                        as: 'os',
                                        cond: { $eq: ['$$os.partner_paid_status', 2] }
                                    }
                                },
                                as: 'paid',
                                in: '$$paid.partner_earning'
                            }
                        }
                    },
                    rating: {
                        $cond: [
                            { $gt: [{ $size: '$order_service' }, 0] },
                            {
                                $avg: {
                                    $map: {
                                        input: {
                                            $filter: {
                                                input: '$order_service',
                                                as: 'os',
                                                cond: { $gt: ['$$os.rating', 0] }
                                            }
                                        },
                                        as: 'os',
                                        in: '$$os.rating'
                                    }
                                }
                            },
                            0
                        ]
                    }
                }
            },
            {
                $project: {
                    partner_id: '$user_id',
                    partner_name: '$name',
                    no_of_services: 1,
                    service_provided: 1,
                    total_earnings: 1,
                    bal_payment: 1,
                    rating: 1,
                    status: {
                        $cond: {
                            if: { $eq: ['$is_active', true] },
                            then: 'Active',
                            else: 'Inactive'
                        }
                    }
                }
            }
        ]);

        const headers = [
            'Partner ID',
            'Partner Name',
            'No Of Services',
            'Service Provided',
            'Total Earnings',
            'Bal Payment',
            'Rating',
            'Status'
        ];

        const { fileBuffer, fileName } = await createExcel({
            headers,
            data: verifications,
            sheetName: 'Partner Report',
            fileName: `Partner.xlsx`
        });

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=${fileName}`
        );

        res.send(
            process.env.NODE_ENV === 'production'
                ? fileBuffer.toString('base64')
                : fileBuffer
        );
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
};

module.exports = {
    exportState,
    exportCity,
    exportArea,
    exportFranchise,
    exportCategory,
    exportService,
    exportUserList,
    exportOrders,
    exportOrderPayments,
    exportPartnerPayments,
    exportUserServices,
    exportTicket,
    exportVerification,
    exportUser,
    exportPartner
}