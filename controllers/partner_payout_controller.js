const partnerPayoutService = require('../services/partner_payout_service');

const sendServiceResult = (res, result) => {
    if (!result.ok) {
        return res.status(result.status).json({
            success: false,
            message: result.message,
        });
    }
    return res.status(result.status).json({
        success: true,
        ...result.data,
    });
};

const getAll = async (req, res) => {
    const result = await partnerPayoutService.listPartnerPayouts(req.query);
    return sendServiceResult(res, result);
};

const getPartners = async (req, res) => {
    const result = await partnerPayoutService.listPartnersForDropdown(req.query);
    return sendServiceResult(res, result);
};

const create = async (req, res) => {
    const result = await partnerPayoutService.createPartnerPayout(req.body);
    return sendServiceResult(res, result);
};

const show = async (req, res) => {
    const result = await partnerPayoutService.getPartnerWalletLedger(req.query);
    return sendServiceResult(res, result);
};

module.exports = {
    getAll,
    getPartners,
    create,
    show,
};
