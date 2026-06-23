const mongoose = require('mongoose');
const Order = require('../models/order');
const refundService = require('../services/refund_service');
const {
    resolveRefundListScope,
    assertRefundRecordAccess,
} = require('../utils/refund_access');
const { fieldLabel } = require('../utils/field_labels');

const sendServiceResult = (res, result) => {
    if (!result.ok) {
        const { status, message, ok: _ok, ...extra } = result;
        return res.status(status).json({
            success: false,
            message,
            ...extra,
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

const getAll = async (req, res) => {
    const scopeResult = await resolveRefundListScope(req, {
        franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scopeResult.ok) return sendScopeError(res, scopeResult);

    const result = await refundService.listRefunds(req.query, scopeResult.filter);
    return sendServiceResult(res, result);
};

const getEligibleOrders = async (req, res) => {
    const scopeResult = await resolveRefundListScope(req, {
        franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scopeResult.ok) return sendScopeError(res, scopeResult);

    const result = await refundService.listEligibleOrders(req.query, scopeResult.filter);
    return sendServiceResult(res, result);
};

const getById = async (req, res) => {
    const refundId = req.params.id ?? req.query.id;
    const result = await refundService.getRefundById(refundId);
    if (!result.ok) return sendServiceResult(res, result);

    const access = await assertRefundRecordAccess(req, result.data);
    if (!access.ok) {
        return res.status(access.status).json({
            success: false,
            message: access.message,
        });
    }

    return sendServiceResult(res, result);
};

const create = async (req, res) => {
    const scopeResult = await resolveRefundListScope(req, {
        franchiseIdFromQuery: req.body.franchise_id,
    });
    if (!scopeResult.ok) return sendScopeError(res, scopeResult);

    const orderIdRaw = req.body.order_id;
    if (!orderIdRaw || !mongoose.Types.ObjectId.isValid(String(orderIdRaw).trim())) {
        return res.status(400).json({
            success: false,
            message: `${fieldLabel('order_id')} must be a valid MongoDB ObjectId.`,
        });
    }

    const order = await Order.findOne({
        _id: orderIdRaw,
        deleted_at: null,
    })
        .select('_id franchise_id')
        .lean();

    if (!order) {
        return res.status(404).json({
            success: false,
            message: 'Order not found.',
        });
    }

    const access = await assertRefundRecordAccess(req, order);
    if (!access.ok) {
        return res.status(access.status).json({
            success: false,
            message: access.message,
        });
    }

    const callerId =
        (req.user && (req.user.id || req.user._id)) || null;

    const result = await refundService.createRefund(req.body, callerId);
    return sendServiceResult(res, result);
};

module.exports = {
    getAll,
    getEligibleOrders,
    getById,
    create,
};
