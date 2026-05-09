const { isValidCount } = require('../validator/form_validator')

const createUserHomeCountsMiddleware = (req, res, next) => {
    const body = req.body;
    const { total_distance_travelled,
        served,
        consulted,
        captured, } = body;

    const totalDistanceTravelledValidateResult = isValidCount(total_distance_travelled)
    if (totalDistanceTravelledValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: totalDistanceTravelledValidateResult.message
        });
    }
    const servedValidateResult = isValidCount(served)
    if (servedValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: servedValidateResult.message
        });
    }
    const consultedValidateResult = isValidCount(consulted)
    if (consultedValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: consultedValidateResult.message
        });
    }
    const capturedValidateResult = isValidCount(captured)
    if (capturedValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: capturedValidateResult.message
        });
    }
    next();
};

const updateUserHomeCountsMiddleware = (req, res, next) => {
    
    const body = req.body;
    const { total_distance_travelled,
        served,
        consulted,
        captured, } = body;

    const totalDistanceTravelledValidateResult = isValidCount(total_distance_travelled)
    if (total_distance_travelled !== undefined && totalDistanceTravelledValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: totalDistanceTravelledValidateResult.message
        });
    }
    const servedValidateResult = isValidCount(served)
    if (served !== undefined && servedValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: servedValidateResult.message
        });
    }
    const consultedValidateResult = isValidCount(consulted)
    if (consulted !== undefined && consultedValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: consultedValidateResult.message
        });
    }
    const capturedValidateResult = isValidCount(captured)
    if (captured !== undefined && capturedValidateResult.valid === false) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: capturedValidateResult.message
        });
    }
    next();
};

module.exports = { createUserHomeCountsMiddleware, updateUserHomeCountsMiddleware };