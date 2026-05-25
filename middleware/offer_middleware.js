const mongoose = require('mongoose');
const { fieldLabel } = require('../utils/field_labels');
const Offer = require('../models/offer');
const User = require('../models/user');
const OFFER_TYPES = Offer.OFFER_TYPES;

const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

/** After authMiddleware — all /api/offer routes: Super Admin (5) or Staff (6) only. */
const requireOfferCreatePermission = async (req, res, next) => {
    try {
        const user = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type');
        const type = Number(user?.type);
        if (user && (type === USER_TYPE_SUPER_ADMIN || type === USER_TYPE_STAFF)) {
            return next();
        }
        return res.status(403).json({
            success: false,
            status: 403,
            message: 'You do not have permission to perform this action.',
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

const PERCENTAGE_AMOUNT_FIELDS = ['value', 'admin_contribution', 'partner_contribution'];

const getPercentageAmountValidationErrors = (doc) => {
    if (String(doc.type).toLowerCase() !== 'percentage') {
        return [];
    }
    return PERCENTAGE_AMOUNT_FIELDS.filter((field) => {
        const amount = doc[field];
        return amount !== undefined && amount !== null && Number(amount) >= 100;
    }).map((field) => ({
        field,
        message: `${fieldLabel(field)} must be below 100 when type is percentage.`,
    }));
};

const validateOfferIdParam = (req, res, next) => {
    const { id } = req.params;
    if (!id || String(id).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Offer id is required.',
        });
    }
    const idStr = String(id).trim();
    if (!/^[a-fA-F0-9]{24}$/.test(idStr) || !mongoose.Types.ObjectId.isValid(idStr)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Invalid offer id.',
        });
    }
    next();
};

const respondPercentageErrors = (res, docLike) => {
    const errors = getPercentageAmountValidationErrors(docLike);
    if (errors.length === 0) return false;
    return res.status(400).json({
        success: false,
        status: 400,
        message: errors[0].message,
    });
};

const validateOfferType = (type, res) => {
    if (!type || String(type).trim() === '') {
        res.status(400).json({
            success: false,
            status: 400,
            message: 'Offer type is required.',
        });
        return false;
    }
    if (!OFFER_TYPES.includes(String(type).trim().toLowerCase())) {
        res.status(400).json({
            success: false,
            status: 400,
            message: `type must be one of: ${OFFER_TYPES.join(', ')}.`,
        });
        return false;
    }
    return true;
};

const isEmptyValue = (value) =>
    value === undefined || value === null || String(value).trim() === '';

const createOfferMiddleware = (req, res, next) => {
    const {
        name,
        type,
        value,
        admin_contribution,
        partner_contribution,
        start_date,
        end_date,
        is_active,
    } = req.body;

    if (!name || String(name).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Offer name is required.',
        });
    }
    if (!validateOfferType(type, res)) return;
    if (isEmptyValue(value)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Offer value is required.',
        });
    }
    if (isEmptyValue(admin_contribution)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Admin contribution is required.',
        });
    }
    if (isEmptyValue(partner_contribution)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Partner contribution is required.',
        });
    }
    if (isEmptyValue(start_date)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Start date is required.',
        });
    }
    if (isEmptyValue(end_date)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'End date is required.',
        });
    }
    if (is_active === undefined) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Status is required.',
        });
    }

    const docLike = {
        type: String(type).trim().toLowerCase(),
        value,
        admin_contribution,
        partner_contribution,
    };
    if (respondPercentageErrors(res, docLike)) return;
    next();
};

const updateOfferMiddleware = async (req, res, next) => {
    const { type, value, admin_contribution, partner_contribution } = req.body;

    if (req.body.name !== undefined && String(req.body.name).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Offer name cannot be empty.',
        });
    }
    if (type !== undefined && !validateOfferType(type, res)) return;
    if (value !== undefined && isEmptyValue(value)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Offer value cannot be empty.',
        });
    }
    if (admin_contribution !== undefined && isEmptyValue(admin_contribution)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Admin contribution cannot be empty.',
        });
    }
    if (partner_contribution !== undefined && isEmptyValue(partner_contribution)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Partner contribution cannot be empty.',
        });
    }
    if (req.body.start_date !== undefined && isEmptyValue(req.body.start_date)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Start date cannot be empty.',
        });
    }
    if (req.body.end_date !== undefined && isEmptyValue(req.body.end_date)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'End date cannot be empty.',
        });
    }

    const affectsPercentage =
        type !== undefined ||
        value !== undefined ||
        admin_contribution !== undefined ||
        partner_contribution !== undefined;

    if (!affectsPercentage) {
        return next();
    }

    try {
        const offer = await Offer.findOne({ _id: req.params.id, deleted_at: null });
        if (!offer) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'No record found',
            });
        }

        const merged = {
            type: type !== undefined ? String(type).trim().toLowerCase() : offer.type,
            value: value !== undefined ? value : offer.value,
            admin_contribution:
                admin_contribution !== undefined ? admin_contribution : offer.admin_contribution,
            partner_contribution:
                partner_contribution !== undefined ? partner_contribution : offer.partner_contribution,
        };

        if (respondPercentageErrors(res, merged)) return;
        next();
    } catch (err) {
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

module.exports = {
    validateOfferIdParam,
    requireOfferCreatePermission,
    createOfferMiddleware,
    updateOfferMiddleware,
};
