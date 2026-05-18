const offerService = require('../services/offer_service');

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
    const result = await offerService.listOffers(req.query);
    return sendServiceResult(res, result);
};

const create = async (req, res) => {
    const result = await offerService.createOffer(req.body);
    return sendServiceResult(res, result);
};

const update = async (req, res) => {
    const result = await offerService.updateOffer(req.params.id, req.body);
    return sendServiceResult(res, result);
};

const getById = async (req, res) => {
    const result = await offerService.getOfferById(req.params.id);
    return sendServiceResult(res, result);
};

const deleteOffer = async (req, res) => {
    const result = await offerService.softDeleteOffer(req.params.id);
    return sendServiceResult(res, result);
};

module.exports = {
    getAll,
    create,
    update,
    getById,
    deleteOffer,
};
