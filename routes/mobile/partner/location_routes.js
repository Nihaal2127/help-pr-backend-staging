const express = require('express');
const router = express.Router();
const {
  states,
  cities,
  areas,
  pincodes,
} = require('../../../controllers/mobile/partner/location_controller');

router.get('/states', states);
router.get('/cities', cities);
router.get('/areas', areas);
router.get('/pincodes', pincodes);

module.exports = router;
