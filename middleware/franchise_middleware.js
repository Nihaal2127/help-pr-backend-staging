const createFranchiseMiddleware = (req, res, next) => {
    const body = req.body;
    const {
        name,
        state_id,
        city_id,
        admin_id,
        is_active,
        area_id,
    } = body;

    if (!name || name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Franchise name is required.',
        });
    }
    if (!state_id || state_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'State is required.',
        });
    }
    if (!city_id || city_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'City is required.',
        });
    }
    // if (!admin_id || admin_id === '') {
    //     return res.status(400).json({
    //         success: false,
    //         status: 400,
    //         message: 'Admin is required.',
    //     });
    // }
    // if (contact === undefined || contact === null || String(contact).trim() === '') {
    //     return res.status(400).json({
    //         success: false,
    //         status: 400,
    //         message: 'Contact is required.',
    //     });
    // }
    if (is_active === undefined) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Status is required.',
        });
    }
    if (area_id !== undefined && area_id !== null && !Array.isArray(area_id)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'area_id must be an array.',
        });
    }
    const { services, categories } = body;
    if (services !== undefined && services !== null && !Array.isArray(services)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'services must be an array.',
        });
    }
    if (categories !== undefined && categories !== null && !Array.isArray(categories)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'categories must be an array.',
        });
    }
    next();
};

const updateFranchiseMiddleware = (req, res, next) => {
    const body = req.body;
    const { name, state_id, city_id, admin_id, contact, is_active, area_id } = body;

    if (name !== undefined && name === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Franchise name is required.',
        });
    }
    if (state_id !== undefined && state_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'State is required.',
        });
    }
    if (city_id !== undefined && city_id === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'City is required.',
        });
    }
    // if (admin_id !== undefined && admin_id === '') {
    //     return res.status(400).json({
    //         success: false,
    //         status: 400,
    //         message: 'Admin is required.',
    //     });
    // }
    if (contact !== undefined && String(contact).trim() === '') {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'Contact is required.',
        });
    }
    if (area_id !== undefined && area_id !== null && !Array.isArray(area_id)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'area_id must be an array.',
        });
    }
    const { services, categories } = body;
    if (services !== undefined && services !== null && !Array.isArray(services)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'services must be an array.',
        });
    }
    if (categories !== undefined && categories !== null && !Array.isArray(categories)) {
        return res.status(400).json({
            success: false,
            status: 400,
            message: 'categories must be an array.',
        });
    }
    next();
};

module.exports = { createFranchiseMiddleware, updateFranchiseMiddleware };
