const express = require('express');
const router = express.Router();
const userAuthMiddleware = require('../../../middleware/mobile/user/user_auth_middleware');
const { validateOrderIdParam } = require('../../../middleware/mobile/user/order_middleware');
const {
  listOrdersHandler,
  submitOrderReviewHandler,
} = require('../../../controllers/mobile/user/order_controller');

router.get('/orders', userAuthMiddleware, listOrdersHandler);
router.post(
  '/orders/:orderId/review',
  userAuthMiddleware,
  validateOrderIdParam,
  submitOrderReviewHandler
);

module.exports = router;
