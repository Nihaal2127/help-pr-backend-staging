const express = require('express');
const router = express.Router();
const { register } = require('../../../controllers/mobile/partner/partner_register_controller');
const { partnerRegisterMiddleware } = require('../../../middleware/mobile/partner/partner_register_middleware');

router.post('/register', partnerRegisterMiddleware, register);

module.exports = router;
