const { isValidPercentage } = require('../validator/form_validator')
const createTaxMiddleware = (req, res, next) => {
    const body = req.body;
    const { user_platform_fee,
        partner_platform_fee,
        partner_commision_fee,
        tax_for_customer, } = body;

    const userPlatformValidateResult = isValidPercentage(user_platform_fee)
    if (userPlatformValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: userPlatformValidateResult.message
        });
    }
    const partnerPlatformValidateResult = isValidPercentage(partner_platform_fee)
    if (partnerPlatformValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: partnerPlatformValidateResult.message
        });
    }
    const partnerComissionValidateResult = isValidPercentage(partner_commision_fee)
    if (partnerComissionValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: partnerComissionValidateResult.message
        });
    }
    const customerTaxValidateResult = isValidPercentage(tax_for_customer)
    if (customerTaxValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: customerTaxValidateResult.message
        });
    }
    next();
};

const updateTaxMiddleware = (req, res, next) => {
    
    const body = req.body;
    const { user_platform_fee,
        partner_platform_fee,
        partner_commision_fee,
        tax_for_customer, } = body;

    const userPlatformValidateResult = isValidPercentage(user_platform_fee)
    if (user_platform_fee !== undefined && userPlatformValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: userPlatformValidateResult.message
        });
    }
    const partnerPlatformValidateResult = isValidPercentage(partner_platform_fee)
    if (partner_platform_fee !== undefined && partnerPlatformValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: partnerPlatformValidateResult.message
        });
    }
    const partnerComissionValidateResult = isValidPercentage(partner_commision_fee)
    if (partner_commision_fee !== undefined && partnerComissionValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: partnerComissionValidateResult.message
        });
    }
    const customerTaxValidateResult = isValidPercentage(tax_for_customer)
    if (tax_for_customer !== undefined && customerTaxValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: customerTaxValidateResult.message
        });
    }
    next();
};

module.exports = { createTaxMiddleware, updateTaxMiddleware };