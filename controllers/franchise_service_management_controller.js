const franchiseServiceManagementService = require('../services/franchise_service_management_service');

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
    const result = await franchiseServiceManagementService.create(req.body);
    return sendServiceResult(res, result);
};

const getAll = async (req, res) => {
    const result = await franchiseServiceManagementService.list(req.query, req.user?.id);
    return sendServiceResult(res, result);
};

const getById = async (req, res) => {
    const result = await franchiseServiceManagementService.getById(
        req.params.id,
        req.user?.id,
        req.query
    );
    return sendServiceResult(res, result);
};

const update = async (req, res) => {
    const result = await franchiseServiceManagementService.update(
        req.params.id,
        req.body,
        req.user?.id
    );
    return sendServiceResult(res, result);
};

module.exports = {
    create,
    getAll,
    getById,
    update,
};
