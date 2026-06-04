const express = require('express');
const router = express.Router();
const userAuthMiddleware = require('../../../middleware/mobile/user/user_auth_middleware');
const { validateOrderIdParam } = require('../../../middleware/mobile/user/order_middleware');
const {
  validatePaymentIdParam,
  validateCreateOrderPaymentBody,
  validateUpdateOrderPaymentBody,
} = require('../../../middleware/mobile/user/order_payment_middleware');
const {
  listOrdersHandler,
  getOrderDetailsHandler,
  submitOrderReviewHandler,
} = require('../../../controllers/mobile/user/order_controller');
const {
  listOrderPaymentsHandler,
  createOrderPaymentHandler,
  updateOrderPaymentHandler,
  deleteOrderPaymentHandler,
} = require('../../../controllers/mobile/user/order_payment_controller');

router.get('/orders', userAuthMiddleware, listOrdersHandler);
router.get(
  '/orders/:orderId/payments',
  userAuthMiddleware,
  validateOrderIdParam,
  listOrderPaymentsHandler
);
router.post(
  '/orders/:orderId/payments',
  userAuthMiddleware,
  validateOrderIdParam,
  validateCreateOrderPaymentBody,
  createOrderPaymentHandler
);
router.put(
  '/orders/:orderId/payments/:paymentId',
  userAuthMiddleware,
  validateOrderIdParam,
  validatePaymentIdParam,
  validateUpdateOrderPaymentBody,
  updateOrderPaymentHandler
);
router.delete(
  '/orders/:orderId/payments/:paymentId',
  userAuthMiddleware,
  validateOrderIdParam,
  validatePaymentIdParam,
  deleteOrderPaymentHandler
);
router.get(
  '/orders/:orderId',
  userAuthMiddleware,
  validateOrderIdParam,
  getOrderDetailsHandler
);
router.post(
  '/orders/:orderId/review',
  userAuthMiddleware,
  validateOrderIdParam,
  submitOrderReviewHandler
);

module.exports = router;
