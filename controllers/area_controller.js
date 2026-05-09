const areaService = require('../services/area_service');

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
    const result = await areaService.listAreas(req.query);
    return sendServiceResult(res, result);
};

const create = async (req, res) => {
    const result = await areaService.createArea(req.body);
    return sendServiceResult(res, result);
};

const update = async (req, res) => {
    const result = await areaService.updateArea(req.params.id, req.body);
    return sendServiceResult(res, result);
};

const getById = async (req, res) => {
    const result = await areaService.getAreaById(req.params.id);
    return sendServiceResult(res, result);
};

const deleteArea = async (req, res) => {
    const result = await areaService.softDeleteArea(req.params.id);
    return sendServiceResult(res, result);
};

const importRecords = async (req, res) => {
    const result = await areaService.importAreas(req.body.records);
    return sendServiceResult(res, result);
};

const getDropDown = async (req, res) => {
    const result = await areaService.listAreasForDropdown(req.query);
    return sendServiceResult(res, result);
};

module.exports = {
    getAll,
    create,
    update,
    getById,
    deleteArea,
    importRecords,
    getDropDown,
};
