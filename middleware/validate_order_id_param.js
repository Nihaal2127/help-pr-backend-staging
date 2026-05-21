const mongoose = require('mongoose');

const isValidObjectIdString = (id) => {
    if (id === undefined || id === null) return false;
    const idStr = String(id).trim();
    if (idStr === '') return false;
    return /^[a-fA-F0-9]{24}$/.test(idStr) && mongoose.Types.ObjectId.isValid(idStr);
};

const validateOrderIdParam = (req, res, next) => {
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

module.exports = { validateOrderIdParam, isValidObjectIdString };
