const mongoose = require('mongoose');
const {
    ORDER_STATUS,
    PARTNER_PAYMENT_STATUS,
    CUSTOMER_PAYMENT_STATUS,
} = require('../models/financial_order');

const isValidObjectIdString = (id) => {
    if (id === undefined || id === null) return false;
    const idStr = String(id).trim();
    if (idStr === '') return false;
    return /^[a-fA-F0-9]{24}$/.test(idStr) && mongoose.Types.ObjectId.isValid(idStr);
};

const validateFinancialOrderIdParam = (req, res, next) => {
    const { id } = req.params;
    if (!id || String(id).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Order id is required.',
        });
    }
    if (!isValidObjectIdString(id)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Invalid order id.',
        });
    }
    next();
};

const isValidEnum = (value, allowed) => {
    if (value === undefined || value === null || value === '') return true;
    return allowed.includes(String(value).trim());
};

const isValidNumber = (value, { allowEmpty = false } = {}) => {
    if (value === undefined || value === null || value === '') return allowEmpty;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0;
};

const createFinancialOrderMiddleware = (req, res, next) => {
    const body = req.body;
    const requiredStrings = [
        ['user_id', 'User is required.'],
        ['user_name', 'User name is required.'],
        ['partner_id', 'Partner is required.'],
        ['partner_name', 'Partner name is required.'],
        ['service_name', 'Service name is required.'],
        ['service_date', 'Service date is required.'],
    ];

    for (const [field, message] of requiredStrings) {
        if (!body[field] || String(body[field]).trim() === '') {
            return res.status(400).json({ success: false, status: 400, message });
        }
    }

    if (!isValidObjectIdString(body.user_id)) {
        return res.status(400).json({ success: false, status: 400, message: 'Invalid user id.' });
    }
    if (!isValidObjectIdString(body.partner_id)) {
        return res.status(400).json({ success: false, status: 400, message: 'Invalid partner id.' });
    }
    if (body.order_id && !isValidObjectIdString(body.order_id)) {
        return res.status(400).json({ success: false, status: 400, message: 'Invalid order id.' });
    }
    if (body.franchise_id && !isValidObjectIdString(body.franchise_id)) {
        return res.status(400).json({ success: false, status: 400, message: 'Invalid franchise id.' });
    }

    if (Number.isNaN(new Date(body.service_date).getTime())) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Valid service date is required.',
        });
    }

    const numericFields = [
        'total_price',
        'commission_percentage',
        'tax_percentage',
        'customer_paid_amount',
        'customer_pending_amount',
        'total_service_amount',
        'paid_to_partner',
        'pending_to_partner',
    ];
    for (const field of numericFields) {
        if (!isValidNumber(body[field])) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: `Valid ${field} is required.`,
            });
        }
    }

    if (!isValidEnum(body.order_status, ORDER_STATUS)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `order_status must be one of: ${ORDER_STATUS.join(', ')}.`,
        });
    }
    if (!isValidEnum(body.partner_payment_status, PARTNER_PAYMENT_STATUS)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `partner_payment_status must be one of: ${PARTNER_PAYMENT_STATUS.join(', ')}.`,
        });
    }
    if (!isValidEnum(body.customer_payment_status, CUSTOMER_PAYMENT_STATUS)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `customer_payment_status must be one of: ${CUSTOMER_PAYMENT_STATUS.join(', ')}.`,
        });
    }

    next();
};

const updateFinancialOrderMiddleware = (req, res, next) => {
    const body = req.body;

    if (body.user_id !== undefined && body.user_id !== null && !isValidObjectIdString(body.user_id)) {
        return res.status(400).json({ success: false, status: 400, message: 'Invalid user id.' });
    }
    if (
        body.partner_id !== undefined &&
        body.partner_id !== null &&
        !isValidObjectIdString(body.partner_id)
    ) {
        return res.status(400).json({ success: false, status: 400, message: 'Invalid partner id.' });
    }
    if (body.order_id !== undefined && body.order_id !== null && String(body.order_id).trim() !== '') {
        if (!isValidObjectIdString(body.order_id)) {
            return res.status(400).json({ success: false, status: 400, message: 'Invalid order id.' });
        }
    }
    if (
        body.franchise_id !== undefined &&
        body.franchise_id !== null &&
        String(body.franchise_id).trim() !== ''
    ) {
        if (!isValidObjectIdString(body.franchise_id)) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Invalid franchise id.',
            });
        }
    }

    if (body.service_date !== undefined && Number.isNaN(new Date(body.service_date).getTime())) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Valid service date is required.',
        });
    }

    const numericFields = [
        'total_price',
        'commission_percentage',
        'tax_percentage',
        'customer_paid_amount',
        'customer_pending_amount',
        'total_service_amount',
        'paid_to_partner',
        'pending_to_partner',
    ];
    for (const field of numericFields) {
        if (body[field] !== undefined && !isValidNumber(body[field])) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: `Valid ${field} is required.`,
            });
        }
    }

    if (body.order_status !== undefined && !isValidEnum(body.order_status, ORDER_STATUS)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `order_status must be one of: ${ORDER_STATUS.join(', ')}.`,
        });
    }
    if (
        body.partner_payment_status !== undefined &&
        !isValidEnum(body.partner_payment_status, PARTNER_PAYMENT_STATUS)
    ) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `partner_payment_status must be one of: ${PARTNER_PAYMENT_STATUS.join(', ')}.`,
        });
    }
    if (
        body.customer_payment_status !== undefined &&
        !isValidEnum(body.customer_payment_status, CUSTOMER_PAYMENT_STATUS)
    ) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `customer_payment_status must be one of: ${CUSTOMER_PAYMENT_STATUS.join(', ')}.`,
        });
    }

    next();
};

module.exports = {
    validateFinancialOrderIdParam,
    createFinancialOrderMiddleware,
    updateFinancialOrderMiddleware,
};
