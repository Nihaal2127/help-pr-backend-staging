const franchiseServiceManagementService = require('../services/franchise_service_management_service');
const { resolveReqUserId } = require('../utils/franchise_user_scope');

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
    try {
        const result = await franchiseServiceManagementService.list(
            req.query,
            resolveReqUserId(req.user)
        );
        return sendServiceResult(res, result);
    } catch (err) {
        console.error('franchiseService.getAll controller', err);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
            error: err?.message || String(err),
        });
    }
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
