const { isValidPrice } = require('../validator/form_validator')
const createCityMiddleware = (req, res, next) => {
    const body = req.body;
    const { name,is_active,state_id,city_service_price } = body;

    if (!name || name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'City name is requiered.'
        });
    }

    if (is_active === undefined) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Status is required.'
        });
    }
    if (!state_id || state_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'State name is requiered.'
        });
    }
    const priceValidateResult = isValidPrice(city_service_price)
    if(priceValidateResult.valid === false){
        return res.status(400).json({
            success: false,
            status: 400,
            message: priceValidateResult.message
        });
    }
    next();
};

const updateCityMiddleware = (req, res, next) => {
    const body = req.body;
    const { name,is_active,state_id,city_service_price } = body;
    if (name !== undefined && name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'City name is requiered.'
        });
    }
    if (state_id !== undefined && state_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'State name is requiered.'
        });
    }
    const priceValidateResult = isValidPrice(city_service_price);
    if (city_service_price !== undefined && priceValidateResult.valid === true) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: priceValidateResult.message
        });
    }
    next();
};

module.exports = { createCityMiddleware, updateCityMiddleware };