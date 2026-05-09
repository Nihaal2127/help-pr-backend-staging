const createDocumentMiddleware = (req, res, next) => {
    
    const { name, is_optional,is_active } = req.body;

    if (!name || name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'State name is requiered.'
        });
    }
    if (is_optional === undefined) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Selecte document is required or not.'
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

const updateDocumentMiddleware = (req, res, next) => {
    const { name, is_optional,is_active } = req.body;
    if (name !== undefined && name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'State name is requiered.'
        });
    }
    if (is_optional === undefined) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Selecte document is required or not.'
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

module.exports = { createDocumentMiddleware, updateDocumentMiddleware };