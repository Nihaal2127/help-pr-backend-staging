const franchiseService = require('../services/franchise_service');

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

const getAll = async (req, res) => {
    const result = await franchiseService.listFranchises(req.query);
    return sendServiceResult(res, result);
};

const create = async (req, res) => {
    const result = await franchiseService.createFranchise(req.body);
    return sendServiceResult(res, result);
};

const update = async (req, res) => {
    const result = await franchiseService.updateFranchise(req.params.id, req.body);
    return sendServiceResult(res, result);
};

const getById = async (req, res) => {
    const result = await franchiseService.getFranchiseById(req.params.id);
    return sendServiceResult(res, result);
};

const deleteFranchise = async (req, res) => {
    const result = await franchiseService.softDeleteFranchise(req.params.id);
    return sendServiceResult(res, result);
};

const importRecords = async (req, res) => {
    const result = await franchiseService.importFranchises(req.body.records);
    return sendServiceResult(res, result);
};

const getDropDown = async (req, res) => {
    const result = await franchiseService.listFranchisesForDropdown(req.query, req.user?.id);
    return sendServiceResult(res, result);
};

const getRelatedCatalog = async (req, res) => {
    const result = await franchiseService.getFranchiseRelatedCatalog(req.params.franchise_id);
    return sendServiceResult(res, result);
};

module.exports = {
    getAll,
    create,
    update,
    getById,
    deleteFranchise,
    importRecords,
    getDropDown,
    getRelatedCatalog,
};
