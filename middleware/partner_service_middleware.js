const { isArray } = require("../validator/array_validator");
const { checkObjectIdExists } = require('../validator/id_validator');
const User = require('../models/user');
const Category = require('../models/category');
const Service = require('../models/service');
const checkServiceMiddleware = (req, res, next) => {
    const items = req.body.services;

    if (!items || !isArray(items)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Order items must be a non-empty array.',
        });
    }

    for (let i = 0; i < items.length; i++) {
        const {
            partner_id,
            category_id,
            service_id,
            is_accept_request
        } = items[i];
        if (!partner_id) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: "Partner id is requiered.",
            });
        }
        const partner_id_data = checkObjectIdExists(User, partner_id, 'partner')
        if (partner_id_data.exists === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: partner_id_data.message,
            });
        }
        if (!category_id) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: "Category id is requiered.",
            });
        }
        const  category_id_data = checkObjectIdExists(Category, category_id, 'category')
        if (category_id_data.exists === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: category_id_data.message,
            });
        }
        if (!service_id) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: "Service id is requiered.",
            });
        }
        const service_id_data = checkObjectIdExists(Service, service_id, 'service')
        if (service_id_data.exists === false) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: service_id_data.message,
            });
        }
        if (is_accept_request === undefined) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: 'Accept request status is required.',
            });
        }
    }
    next();
};

module.exports = { checkServiceMiddleware };