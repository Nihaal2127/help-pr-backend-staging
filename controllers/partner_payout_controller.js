const mongoose = require('mongoose');
const User = require('../models/user');
const partnerPayoutService = require('../services/partner_payout_service');
const {
    resolvePartnerPayoutListScope,
    assertPartnerRecordAccess,
} = require('../utils/partner_payout_access');
const { fieldLabel } = require('../utils/field_labels');

const PARTNER_USER_TYPE = 2;

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

const sendScopeError = (res, scopeResult) =>
    res.status(scopeResult.status).json({
        success: false,
        message: scopeResult.message,
    });

const applyFranchiseScopeToBody = (body, scopeFilter) => {
    const fid = scopeFilter?.franchise_id;
    if (fid && !fid.$in) {
        body.franchise_id = String(fid);
    }
};

const loadPartnerForAccess = async (partnerIdRaw) => {
    if (!partnerIdRaw || !mongoose.Types.ObjectId.isValid(String(partnerIdRaw).trim())) {
        return { ok: false, status: 400, message: `${fieldLabel('partner_id')} must be a valid MongoDB ObjectId.` };
    }
    const partner = await User.findOne({
        _id: partnerIdRaw,
        type: PARTNER_USER_TYPE,
        deleted_at: null,
    })
        .select('_id franchise_id')
        .lean();
    if (!partner) {
        return { ok: false, status: 404, message: 'Partner not found.' };
    }
    return { ok: true, partner };
};

const getAll = async (req, res) => {
    const scopeResult = await resolvePartnerPayoutListScope(req, {
        franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scopeResult.ok) return sendScopeError(res, scopeResult);

    const result = await partnerPayoutService.listPartnerPayouts(req.query, scopeResult.filter);
    return sendServiceResult(res, result);
};

const getPartners = async (req, res) => {
    const scopeResult = await resolvePartnerPayoutListScope(req, {
        franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scopeResult.ok) return sendScopeError(res, scopeResult);

    const result = await partnerPayoutService.listPartnersForDropdown(req.query, scopeResult.filter);
    return sendServiceResult(res, result);
};

const create = async (req, res) => {
    const scopeResult = await resolvePartnerPayoutListScope(req, {
        franchiseIdFromQuery: req.body.franchise_id,
    });
    if (!scopeResult.ok) return sendScopeError(res, scopeResult);

    applyFranchiseScopeToBody(req.body, scopeResult.filter);

    const partnerLoad = await loadPartnerForAccess(req.body.partner_id);
    if (!partnerLoad.ok) {
        return res.status(partnerLoad.status).json({
            success: false,
            message: partnerLoad.message,
        });
    }

    const access = await assertPartnerRecordAccess(req, partnerLoad.partner);
    if (!access.ok) {
        return res.status(access.status).json({
            success: false,
            message: access.message,
        });
    }

    const result = await partnerPayoutService.createPartnerPayout(req.body);
    return sendServiceResult(res, result);
};

const show = async (req, res) => {
    const partnerIdRaw = req.query.id ?? req.query.partner_id;
    const partnerLoad = await loadPartnerForAccess(partnerIdRaw);
    if (!partnerLoad.ok) {
        return res.status(partnerLoad.status).json({
            success: false,
            message: partnerLoad.message,
        });
    }

    const access = await assertPartnerRecordAccess(req, partnerLoad.partner);
    if (!access.ok) {
        return res.status(access.status).json({
            success: false,
            message: access.message,
        });
    }

    const result = await partnerPayoutService.getPartnerWalletLedger(req.query);
    return sendServiceResult(res, result);
};

module.exports = {
    getAll,
    getPartners,
    create,
    show,
};
