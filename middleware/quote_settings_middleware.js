const { isValidCount, isValidPrice } = require('../validator/form_validator');

const validateField = (res, value, validator) => {
    const result = validator(value);
    if (result.valid === false) {
        res.status(400).json({
            success: false,
            status: 400,
            message: result.message,
        });
        return false;
    }
    return true;
};

const createQuoteSettingsMiddleware = (req, res, next) => {
    const { free_quotes_per_user, no_of_quotes, quotes_price } = req.body;

    if (!validateField(res, free_quotes_per_user, isValidCount)) return;
    if (!validateField(res, no_of_quotes, isValidCount)) return;
    if (!validateField(res, quotes_price, isValidPrice)) return;

    next();
};

const updateQuoteSettingsMiddleware = (req, res, next) => {
    const { free_quotes_per_user, no_of_quotes, quotes_price } = req.body;

    if (free_quotes_per_user !== undefined && !validateField(res, free_quotes_per_user, isValidCount)) return;
    if (no_of_quotes !== undefined && !validateField(res, no_of_quotes, isValidCount)) return;
    if (quotes_price !== undefined && !validateField(res, quotes_price, isValidPrice)) return;

    next();
};

module.exports = { createQuoteSettingsMiddleware, updateQuoteSettingsMiddleware };
