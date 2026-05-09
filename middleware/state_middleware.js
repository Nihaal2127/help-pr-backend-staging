const createStateMiddleware = (req, res, next) => {
    const body = req.body;
    const { name, is_active } = body;

    if (!name || name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'State name is requiered.'
        });
    }
    if (is_active === undefined) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Status is required.'
        });
    }
    next();
};

const updateStateMiddleware = (req, res, next) => {
    const body = req.body;

    if (body.name !== undefined && body.name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'State name is requiered.'
        });
    }
    next();
};

module.exports = { createStateMiddleware, updateStateMiddleware };