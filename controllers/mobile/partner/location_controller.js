const locationService = require('../../../services/mobile/partner/location_service');

const sendServiceResult = (res, result) => {
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      status: result.status,
      message: result.message,
    });
  }
  return res.status(result.status).json({
    success: true,
    status: result.status,
    ...result.data,
  });
};

const states = async (req, res) => {
  const result = await locationService.listStatesForPartner();
  return sendServiceResult(res, result);
};

const cities = async (req, res) => {
  const { stateOids = [] } = req.mobileLocationQuery || {};
  const result = await locationService.listCitiesForPartner({ stateOids });
  return sendServiceResult(res, result);
};

const areas = async (req, res) => {
  const { cityOids = [], stateOids = [] } = req.mobileLocationQuery || {};
  const result = await locationService.listAreasForPartner({ cityOids, stateOids });
  return sendServiceResult(res, result);
};

const pincodes = async (req, res) => {
  const { areaOids = [] } = req.mobileLocationQuery || {};
  const result = await locationService.listPincodesForPartner({ areaOids });
  return sendServiceResult(res, result);
};

module.exports = {
  states,
  cities,
  areas,
  pincodes,
};
