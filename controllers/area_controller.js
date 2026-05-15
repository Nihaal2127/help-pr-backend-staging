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
    const query = { ...req.query };
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const bodyType = body.type !== undefined && body.type !== null ? String(body.type).trim() : '';
    const queryType = query.type !== undefined && query.type !== null ? String(query.type).trim() : '';
    if (!queryType && bodyType) {
        query.type = body.type;
    }

    if (
        (query.franchise_id === undefined || query.franchise_id === null || String(query.franchise_id).trim() === '') &&
        body.franchise_id !== undefined &&
        body.franchise_id !== null &&
        String(body.franchise_id).trim() !== ''
    ) {
        query.franchise_id = body.franchise_id;
    }
    if (
        (query.franchise === undefined || query.franchise === null || String(query.franchise).trim() === '') &&
        body.franchise !== undefined &&
        body.franchise !== null &&
        String(body.franchise).trim() !== ''
    ) {
        query.franchise = body.franchise;
    }

    const result = await areaService.listAreas(query, req.user);
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
