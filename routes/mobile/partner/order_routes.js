const express = require('express');
const router = express.Router();
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const { requirePartnerAccount } = require('../../../middleware/mobile/partner/quote_middleware');
const { validateOrderIdParam } = require('../../../middleware/mobile/partner/order_middleware');
const {
  listOrdersHandler,
  getOrderDetailsHandler,
} = require('../../../controllers/mobile/partner/order_controller');

router.use(partnerAuthMiddleware, requirePartnerAccount);

router.get('/orders', listOrdersHandler);
router.get('/orders/:orderId', validateOrderIdParam, getOrderDetailsHandler);

module.exports = router;
