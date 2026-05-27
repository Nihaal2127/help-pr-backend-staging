const express = require('express');
const router = express.Router();
const {
  states,
  cities,
  areas,
  pincodes,
} = require('../../../controllers/mobile/common/location_controller');
const {
  validateStatesQuery,
  validateCitiesQuery,
  validateAreasQuery,
  validatePincodesQuery,
} = require('../../../middleware/mobile/common/location_middleware');

router.get('/states', validateStatesQuery, states);
router.get('/cities', validateCitiesQuery, cities);
router.get('/areas', validateAreasQuery, areas);
router.get('/pincodes', validatePincodesQuery, pincodes);

module.exports = router;
