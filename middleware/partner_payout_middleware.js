const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../models/partner_payout');
const { fieldLabel } = require('../utils/field_labels');

const isValidObjectIdString = (id) => {
    if (id === undefined || id === null) return false;
    const idStr = String(id).trim();
    if (idStr === '') return false;
    return /^[a-fA-F0-9]{24}$/.test(idStr) && mongoose.Types.ObjectId.isValid(idStr);
};

const createPartnerPayoutMiddleware = (req, res, next) => {
    const { partner_id, pay_now_amount, payment_method, description, franchise_id } = req.body;

    if (!partner_id || String(partner_id).trim() === '') {
        return res.status(400).json({
            success: false,
            message: `${fieldLabel('partner_id')} is required.`,
        });
    }
    if (!isValidObjectIdString(partner_id)) {
        return res.status(400).json({
            success: false,
            message: `${fieldLabel('partner_id')} must be a valid MongoDB ObjectId.`,
        });
    }

    const amount = Number(pay_now_amount);
    if (
        pay_now_amount === undefined ||
        pay_now_amount === null ||
        !Number.isFinite(amount) ||
        amount <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: `Valid ${fieldLabel('pay_now_amount')} is required.`,
        });
    }

    if (!payment_method || String(payment_method).trim() === '') {
        return res.status(400).json({
            success: false,
            message: `${fieldLabel('payment_method')} is required.`,
        });
    }
    const method = String(payment_method).trim().toLowerCase();
    if (!PAYMENT_METHODS.includes(method)) {
        return res.status(400).json({
            success: false,
            message: `${fieldLabel('payment_method')} must be one of: ${PAYMENT_METHODS.join(', ')}.`,
        });
    }

    if (!description || String(description).trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'description is required.',
        });
    }

    if (franchise_id !== undefined && franchise_id !== null && String(franchise_id).trim() !== '') {
        if (!isValidObjectIdString(franchise_id)) {
            return res.status(400).json({
                success: false,
                message: `${fieldLabel('franchise_id')} must be a valid MongoDB ObjectId.`,
            });
        }
    }

    next();
};

const validatePartnerLedgerQuery = (req, res, next) => {
    const partnerId = req.query.id ?? req.query.partner_id;
    if (!partnerId || String(partnerId).trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'id is required.',
        });
    }
    if (!isValidObjectIdString(partnerId)) {
        return res.status(400).json({
            success: false,
            message: 'id must be a valid MongoDB ObjectId.',
        });
    }
    next();
};

module.exports = {
    createPartnerPayoutMiddleware,
    validatePartnerLedgerQuery,
};
