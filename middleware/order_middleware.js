const User = require('../models/user')

const City = require('../models/city')

const Category = require('../models/category')

const Service = require('../models/service')
const Offer = require('../models/offer')

const { checkObjectIdExists } = require('../validator/id_validator')

const { resolveTotalServiceCharge } = require('../utils/order_pricing')
const { isValidOrderStatus } = require('../enum/order_status_enum')
const { fieldLabel } = require('../utils/field_labels')

const isValidPositiveAmount = (value) => {

    const n = Number(value);

    return Number.isFinite(n) && n > 0;

};



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

        order_date,

        address,

        discount_amount,

        offer_id,

        service_id,

        service_items,

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



    const singleItem =

        Array.isArray(service_items) && service_items.length === 1

            ? service_items[0]

            : {};

    const totalCharge = resolveTotalServiceCharge(body, singleItem);

    if (!isValidPositiveAmount(totalCharge)) {

        return res.status(409).json({

            success: false,

            status: 409,

            message: `${fieldLabel('total_service_charge')} (or ${fieldLabel('service_price')}) is required and must be greater than 0.`,

        });

    }



    const resolvedServiceId = service_id ?? singleItem.service_id;

    const serviceResult = await checkObjectIdExists(Service, resolvedServiceId, 'service');

    if (serviceResult.exists === false) {

        return res.status(409).json({

            success: false,

            status: 409,

            message: `Valid ${fieldLabel('service_id')} is required.`,

        });

    }



    if (discount_amount !== undefined && discount_amount !== null && discount_amount !== '') {

        const disc = Number(discount_amount);

        if (!Number.isFinite(disc) || disc < 0) {

            return res.status(409).json({

                success: false,

                status: 409,

                message: 'Discount amount is invalid.',

            });

        }

    }

    if (offer_id !== undefined && offer_id !== null && String(offer_id).trim() !== '') {

        if (discount_amount !== undefined && discount_amount !== null && discount_amount !== '') {

            return res.status(409).json({

                success: false,

                status: 409,

                message: `Send ${fieldLabel('offer_id')} or ${fieldLabel('discount_amount')}, not both.`,

            });

        }

        const offerResult = await checkObjectIdExists(Offer, offer_id, 'offer');

        if (offerResult.exists === false) {

            return res.status(409).json({

                success: false,

                status: 409,

                message: offerResult.message,

            });

        }

    }

    next();

};



const checkItemsMiddleware = async (req, res, next) => {

    const items = req.body.service_items;

    const type = req.body.type;

    if (!Array.isArray(items)) {

        return res.status(409).json({

            success: false,

            status: 409,

            message: `${fieldLabel('service_items')} must be an array.`,

        });

    }

    if (items.length !== 1) {

        return res.status(409).json({

            success: false,

            status: 409,

            message: `Each order must contain exactly one service; ${fieldLabel('service_items')} must have length 1.`,

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

        const serviceResult = await checkObjectIdExists(Service, service_id, 'service');

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



        const lineCharge = resolveTotalServiceCharge(req.body, items[i]);

        if (!isValidPositiveAmount(lineCharge)) {

            return res.status(409).json({

                success: false,

                status: 409,

                message: `${fieldLabel('total_service_charge')} (or ${fieldLabel('service_price')}) on ${fieldLabel('service_items')} is required and must be greater than 0.`,

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

    if (

        service_status !== undefined &&

        service_status !== null &&

        String(service_status).trim() !== '' &&

        !isValidOrderStatus(service_status)

    ) {

        return res.status(409).json({

            success: false,

            status: 409,

            message: 'Service status is invalid. Use: in-progress, completed, cancelled, refunded.',

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

module.exports = { createOrderMiddleware, checkItemsMiddleware, updateOrderServiceMiddleware };

