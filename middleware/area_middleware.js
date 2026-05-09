const createAreaMiddleware = (req, res, next) => {
    const body = req.body;
    const { name, is_active, city_id, pincodes } = body;

    if (!name || name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Area name is required.',
        });
    }

    if (is_active === undefined) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Status is required.',
        });
    }
    if (!city_id || city_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'City is required.',
        });
    }
    if (pincodes !== undefined && pincodes !== null && !Array.isArray(pincodes)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Pincodes must be an array.',
        });
    }
    next();
};

const updateAreaMiddleware = (req, res, next) => {
    const body = req.body;
    const { name, is_active, city_id, pincodes } = body;
    if (name !== undefined && name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Area name is required.',
        });
    }
    if (city_id !== undefined && city_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'City is required.',
        });
    }
    if (pincodes !== undefined && pincodes !== null && !Array.isArray(pincodes)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Pincodes must be an array.',
        });
    }
    next();
};

module.exports = { createAreaMiddleware, updateAreaMiddleware };
