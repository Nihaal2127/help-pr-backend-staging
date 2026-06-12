const locationService = require('../../../services/mobile/common/location_service');
const {
  wrapMobileHandler,
  sendSpreadDataResult,
} = require('../../../utils/mobile_controller_helpers');

const states = wrapMobileHandler('mobile location states', async (req, res) => {
  const result = await locationService.listStatesForPartner();
  return sendSpreadDataResult(res, result);
});

const cities = wrapMobileHandler('mobile location cities', async (req, res) => {
  const { stateOids = [] } = req.mobileLocationQuery || {};
  const result = await locationService.listCitiesForPartner({ stateOids });
  return sendSpreadDataResult(res, result);
});

const areas = wrapMobileHandler('mobile location areas', async (req, res) => {
  const { cityOids = [], stateOids = [] } = req.mobileLocationQuery || {};
  const result = await locationService.listAreasForPartner({ cityOids, stateOids });
  return sendSpreadDataResult(res, result);
});

const pincodes = wrapMobileHandler('mobile location pincodes', async (req, res) => {
  const { areaOids = [] } = req.mobileLocationQuery || {};
  const result = await locationService.listPincodesForPartner({ areaOids });
  return sendSpreadDataResult(res, result);
});

module.exports = {
  states,
  cities,
  areas,
  pincodes,
};
