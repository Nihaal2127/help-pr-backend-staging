const express = require('express');
const router = express.Router();
const userAuthMiddleware = require('../../../middleware/mobile/user/user_auth_middleware');
const { listOrdersHandler } = require('../../../controllers/mobile/user/order_controller');

router.get('/orders', userAuthMiddleware, listOrdersHandler);

module.exports = router;
