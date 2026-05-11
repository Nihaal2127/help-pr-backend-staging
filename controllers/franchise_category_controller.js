const franchiseCategoryService = require('../services/franchise_category_service');

const sendServiceResult = (res, result) => {
    if (!result.ok) {
        return res.status(result.status).json({
            success: false,
            status: result.status,
            message: result.message,
            ...(result.error !== undefined && { error: result.error }),
        });
    }
    return res.status(result.status).json({
        success: true,
        status: result.status,
        ...result.data,
    });
};

const create = async (req, res) => {
    const result = await franchiseCategoryService.create(req.body);
    return sendServiceResult(res, result);
};

const getAll = async (req, res) => {
    const result = await franchiseCategoryService.list(req.query, req.user?.id);
    return sendServiceResult(res, result);
};

const getById = async (req, res) => {
    const result = await franchiseCategoryService.getById(req.params.id, req.user?.id, req.query);
    return sendServiceResult(res, result);
};

const update = async (req, res) => {
    const result = await franchiseCategoryService.update(req.params.id, req.body, req.user?.id);
    return sendServiceResult(res, result);
};

module.exports = {
    create,
    getAll,
    getById,
    update,
};
