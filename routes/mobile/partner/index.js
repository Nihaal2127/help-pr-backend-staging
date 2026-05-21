const express = require('express');
const router = express.Router();
const { register, login } = require('../../../controllers/mobile/partner/partner_controller');
const {
  partnerRegisterMiddleware,
  partnerLoginMiddleware,
} = require('../../../middleware/mobile/partner/partner_middleware');

router.post('/register', partnerRegisterMiddleware, register);
router.post('/login', partnerLoginMiddleware, login);

module.exports = router;
