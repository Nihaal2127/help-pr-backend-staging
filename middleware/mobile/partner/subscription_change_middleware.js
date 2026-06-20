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
        return { ok: false, message: `${fieldName} must be a non-negative number.` };
    }
    return { ok: true, value: n };
};

const validateTargetPlanId = (req, res, next) => {
    const targetPlanId = req.body?.target_plan_id;
    if (!targetPlanId || String(targetPlanId).trim() === '') {
        return sendError(res, 400, 'target_plan_id is required.');
    }
    if (!OBJECT_ID_HEX_24.test(String(targetPlanId).trim())) {
        return sendError(res, 400, 'target_plan_id must be a valid ObjectId.');
    }
    next();
};

const validateApplyChangeBody = (req, res, next) => {
    const targetPlanId = req.body?.target_plan_id;
    if (!targetPlanId || String(targetPlanId).trim() === '') {
        return sendError(res, 400, 'target_plan_id is required.');
    }
    if (!OBJECT_ID_HEX_24.test(String(targetPlanId).trim())) {
        return sendError(res, 400, 'target_plan_id must be a valid ObjectId.');
    }

    const walletParsed = parseNonNegativeAmount(req.body.wallet_amount, 'wallet_amount');
    if (!walletParsed.ok) return sendError(res, 400, walletParsed.message);

    const cashParsed = parseNonNegativeAmount(req.body.cash_amount, 'cash_amount');
    if (!cashParsed.ok) return sendError(res, 400, cashParsed.message);

    const onlineParsed = parseNonNegativeAmount(req.body.online_amount, 'online_amount');
    if (!onlineParsed.ok) return sendError(res, 400, onlineParsed.message);

    req.body.wallet_amount = walletParsed.value;
    req.body.cash_amount = cashParsed.value;
    req.body.online_amount = onlineParsed.value;
    next();
};

module.exports = {
    validateTargetPlanId,
    validateApplyChangeBody,
};
