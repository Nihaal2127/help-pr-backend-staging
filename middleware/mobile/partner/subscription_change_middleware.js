const { fieldLabel } = require('../../../utils/field_labels');
const OBJECT_ID_HEX_24 = /^[a-fA-F0-9]{24}$/;

const sendError = (res, status, message) =>
    res.status(status).json({
        success: false,
        status,
        message,
    });

const parseNonNegativeAmount = (raw, fieldName) => {
    if (raw === undefined || raw === null || raw === '') {
        return { ok: true, value: 0 };
    }
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be a non-negative number.` };
    }
    return { ok: true, value: n };
};

const validateTargetPlanId = (req, res, next) => {
    const targetPlanId = req.body?.target_plan_id;
    if (!targetPlanId || String(targetPlanId).trim() === '') {
        return sendError(res, 400, `${fieldLabel('target_plan_id')} is required.`);
    }
    if (!OBJECT_ID_HEX_24.test(String(targetPlanId).trim())) {
        return sendError(res, 400, `${fieldLabel('target_plan_id')} must be a valid ObjectId.`);
    }
    next();
};

const validateApplyChangeBody = (req, res, next) => {
    const targetPlanId = req.body?.target_plan_id;
    if (!targetPlanId || String(targetPlanId).trim() === '') {
        return sendError(res, 400, `${fieldLabel('target_plan_id')} is required.`);
    }
    if (!OBJECT_ID_HEX_24.test(String(targetPlanId).trim())) {
        return sendError(res, 400, `${fieldLabel('target_plan_id')} must be a valid ObjectId.`);
    }

    const walletParsed = parseNonNegativeAmount(req.body.wallet_amount, 'wallet_amount');
    if (!walletParsed.ok) return sendError(res, 400, walletParsed.message);

    const cashParsed = parseNonNegativeAmount(req.body.cash_amount, 'cash_amount');
    if (!cashParsed.ok) return sendError(res, 400, cashParsed.message);

    const onlineParsed = parseNonNegativeAmount(req.body.online_amount, 'online_amount');
    if (!onlineParsed.ok) return sendError(res, 400, onlineParsed.message);

    const paymentMethod = String(req.body.payment_method || '').trim().toLowerCase();
    if (paymentMethod === 'apple') {
        if (walletParsed.value > 0 || cashParsed.value > 0 || onlineParsed.value > 0) {
            return sendError(
                res,
                400,
                'Do not mix wallet, cash, or online amounts with App Store payment.'
            );
        }
        if (req.body.apple_product_id !== undefined && req.body.apple_product_id !== null) {
            req.body.apple_product_id = String(req.body.apple_product_id).trim();
        }
        req.body.payment_method = 'apple';
    }

    req.body.wallet_amount = walletParsed.value;
    req.body.cash_amount = cashParsed.value;
    req.body.online_amount = onlineParsed.value;
    next();
};

const validateAppleVerifyBody = (req, res, next) => {
    const signed = req.body?.signed_transaction_info || req.body?.signedTransactionInfo;
    const transactionId = req.body?.transaction_id || req.body?.transactionId;
    if ((!signed || String(signed).trim() === '') && (!transactionId || String(transactionId).trim() === '')) {
        return sendError(res, 400, `${fieldLabel('signed_transaction_info')} is required.`);
    }
    if (req.body?.change_id) {
        if (!OBJECT_ID_HEX_24.test(String(req.body.change_id).trim())) {
            return sendError(res, 400, `${fieldLabel('change_id')} must be a valid ObjectId.`);
        }
    }
    if (req.body?.target_plan_id) {
        if (!OBJECT_ID_HEX_24.test(String(req.body.target_plan_id).trim())) {
            return sendError(res, 400, `${fieldLabel('target_plan_id')} must be a valid ObjectId.`);
        }
    }
    next();
};

const validateAppleRestoreBody = (req, res, next) => {
    const signed = req.body?.signed_transaction_info || req.body?.signedTransactionInfo;
    const transactionId = req.body?.transaction_id || req.body?.transactionId;
    if ((!signed || String(signed).trim() === '') && (!transactionId || String(transactionId).trim() === '')) {
        return sendError(res, 400, `${fieldLabel('signed_transaction_info')} is required.`);
    }
    next();
};

module.exports = {
    validateTargetPlanId,
    validateApplyChangeBody,
    validateAppleVerifyBody,
    validateAppleRestoreBody,
};
