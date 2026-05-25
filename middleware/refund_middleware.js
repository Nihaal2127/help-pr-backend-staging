const mongoose = require('mongoose');

const isValidObjectIdString = (id) => {
    if (id === undefined || id === null) return false;
    const idStr = String(id).trim();
    if (idStr === '') return false;
    return /^[a-fA-F0-9]{24}$/.test(idStr) && mongoose.Types.ObjectId.isValid(idStr);
};

const isPositiveNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
};

const isNonNegativeNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0;
};

const createRefundMiddleware = (req, res, next) => {
    const {
        order_id,
        refund_amount,
        from_admin_commission,
        from_partner_wallet,
        date,
        refund_date,
    } = req.body;

    if (!order_id || String(order_id).trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'Order ID is required.',
        });
    }
    if (!isValidObjectIdString(order_id)) {
        return res.status(400).json({
            success: false,
            message: 'Order ID must be valid.',
        });
    }

    if (!isPositiveNumber(refund_amount)) {
        return res.status(400).json({
            success: false,
            message: 'Valid refund amount is required.',
        });
    }

    if (
        from_admin_commission !== undefined &&
        from_admin_commission !== null &&
        !isNonNegativeNumber(from_admin_commission)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Admin portion must be a non-negative number.',
        });
    }

    if (
        from_partner_wallet !== undefined &&
        from_partner_wallet !== null &&
        !isNonNegativeNumber(from_partner_wallet)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Partner wallet portion must be a non-negative number.',
        });
    }

    const refundDate = date ?? refund_date;
    if (refundDate === undefined || refundDate === null || String(refundDate).trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'Refund date is required.',
        });
    }
    const parsed = new Date(refundDate);
    if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({
            success: false,
            message: 'Refund date must be valid.',
        });
    }

    next();
};

const validateRefundIdParam = (req, res, next) => {
    const id = req.params.id ?? req.query.id;
    if (!id || String(id).trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'id is required.',
        });
    }
    if (!isValidObjectIdString(id)) {
        return res.status(400).json({
            success: false,
            message: 'id must be a valid MongoDB ObjectId.',
        });
    }
    next();
};

module.exports = {
    createRefundMiddleware,
    validateRefundIdParam,
};
