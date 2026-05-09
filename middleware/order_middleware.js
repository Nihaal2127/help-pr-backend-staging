const User = require('../models/user')
const City = require('../models/city')
const Category = require('../models/category')
const Service = require('../models/service')
const { checkObjectIdExists } = require('../validator/id_validator')
const { isArray } = require('../validator/array_validator')
const { isValidPrice } = require('../validator/form_validator')
const createOrderMiddleware = async (req, res, next) => {
    const body = req.body;
    const {
        user_id,
        user_unique_id,
        city_id,
        category_id,
        is_paid,
        payment_mode_id,
        transaction_id,
        created_by_id,
        order_status,
        order_date,
        address,
        sub_total,
        tax,
        discount_amount,
        user_paltform_fee,
        partner_commison_platform_fee,
        total_price,
        admin_earning,
        type,
    } = body;


    const userResult = await checkObjectIdExists(User, user_id, 'user');
    if (userResult.exists === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: userResult.message,
        });
    }
    if (!user_unique_id || user_unique_id.trim() === '') {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'User unique id is requiered.'
        });
    }
    const cityResult = await checkObjectIdExists(City, city_id, 'city');
    if (cityResult.exists === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: cityResult.message,
        });
    }
    const categoryResult = await checkObjectIdExists(Category, category_id, 'category');
    if (categoryResult.exists === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: categoryResult.message,
        });
    }
    if (is_paid === undefined) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Paymemt status is requiered.'

        });
    }
    if (is_paid === true) {
        if (!transaction_id || transaction_id.trim() === '') {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Transaction id is requiered.'
            });
        }
    }

    const createdByResult = await checkObjectIdExists(User, created_by_id, 'user');
    if (createdByResult.exists === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: createdByResult.message,
        });
    }

    if (order_status === undefined) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Order status is required.'

        });
    }
    if (parseInt(order_status) < 1 || parseInt(order_status) > 4) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Order status is invalid.'
        });
    }
    if (!order_date || order_date === null || order_date.trim() === '') {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Fitting date is requiered.'
        });
    }
    if (!address || address === null) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Address date requiered.'
        });
    }
    if (isValidPrice(sub_total) === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Sub total is required.'
        });
    }

    if (isValidPrice(tax) === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Tax price is required.'
        });
    }
    if (discount_amount && isValidPrice(discount_amount) === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Discount amount is invalid.'
        });
    }
    if (isValidPrice(user_paltform_fee) === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Platform fee is required.'
        });
    }
    if (isValidPrice(partner_commison_platform_fee) === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Partner commison and platform fee is required.'
        });
    }
    if (isValidPrice(admin_earning) === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Admin is required.'
        });
    }
    if (isValidPrice(total_price) === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Total price is required.'
        });
    }
    next();
};

const checkItemsMiddleware = async (req, res, next) => {
    const items = req.body.service_items;
    const type = req.body.type;
    if (!isArray(items)) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Service items must be a non-empty array.',
        });
    }

    for (let i = 0; i < items.length; i++) {
        const {
            user_id,
            partner_id,
            category_id,
            service_id,
            service_date,
            service_from_time,
            service_to_time,
            sub_total,
            tax,
            service_price,
            user_paltform_fee,
            partner_commison_platform_fee,
            partner_earning,
            total_price,
            admin_earning,
        } = items[i];

        const userResult = await checkObjectIdExists(User, user_id, 'user');
        if (userResult.exists === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: userResult.message,
            });
        }
        if (type === 1) {
            const partnerResult = await checkObjectIdExists(User, partner_id, 'partner');
            if (partnerResult.exists === false) {
                return res.status(409).json({
                    success: false,
                    status: 409,
                    message: partnerResult.message,
                });
            }
        }


        const categoryResult = await checkObjectIdExists(Category, category_id, 'category');
        if (categoryResult.exists === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: categoryResult.message,
            });
        }
        const serviceResult = await checkObjectIdExists(Service, service_id, 'city');
        if (serviceResult.exists === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: serviceResult.message,
            });
        }
        if (!service_date || service_date === null) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Service date requiered.'
            });
        }
        if (!service_from_time || service_from_time === null) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Service start time requiered.'
            });
        }
        if (!service_to_time || service_to_time === null) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Service end time requiered.'
            });
        }
        if (isValidPrice(sub_total) === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Sub total is required.'
            });
        }
        if (isValidPrice(tax) === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Tax price is required.'
            });
        }
        if (isValidPrice(service_price) === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Service price is required.'
            });
        }
        if (isValidPrice(user_paltform_fee) === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Platform fee is required.'
            });
        }
        if (isValidPrice(partner_commison_platform_fee) === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Partner commison and platform fee is required.'
            });
        }
        if (isValidPrice(partner_earning) === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Partner earning is required.'
            });
        }
        if (isValidPrice(admin_earning) === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Admin is required.'
            });
        }
        if (isValidPrice(total_price) === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Total price is required.'
            });
        }
    }
    next();
};

const updateOrderServiceMiddleware = async (req, res, next) => {
    const body = req.body;
    const {
        partner_id,
        service_status,
        service_date,
        service_from_time,
        service_to_time,
    } = body;

    const partnerResult = await checkObjectIdExists(User, partner_id, 'partner');
    if (partner_id !== undefined && partnerResult.exists === false) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: partnerResult.message,
        });
    }
   if (parseInt(service_status) < 1 || parseInt(service_status) > 3) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Service status is invalid.'
        });
    }
    if (service_date !== undefined && (!service_date  || service_date === null || service_date.trim() === '')) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Service date is requiered.'
        });
    }
    if (service_from_time !== undefined && (!service_from_time  || service_from_time === null || service_from_time.trim() === '')) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Service from time is requiered.'
        });
    }
    if (service_to_time !== undefined && (!service_to_time  || service_to_time === null || service_to_time.trim() === '')) {
        return res.status(409).json({
            success: false,
            status: 409,
            message: 'Service to time is requiered.'
        });
    }
    next();
};

const payComissionMiddleware = (req, res, next) => {
    const items = req.body.order_service_ids;
    const partner_paid_status = req.body.partner_paid_status;
    if(partner_paid_status === undefined){
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Paymemt statsu missing.',
        });
    }
    if(partner_paid_status < 1 || partner_paid_status > 3){
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Paymemt statsu invalid.',
        });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Order id must be a non-empty array.',
        });
    }
    next();
};
module.exports = { createOrderMiddleware, checkItemsMiddleware,updateOrderServiceMiddleware,payComissionMiddleware };