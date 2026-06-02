const express = require('express');
const router = express.Router();
const userAuthMiddleware = require('../../../middleware/mobile/user/user_auth_middleware');
const {
  createQuoteHandler,
  listQuotesHandler,
  getQuoteHandler,
  updateQuoteHandler,
  cancelQuoteHandler,
  convertQuoteToOrderHandler,
} = require('../../../controllers/mobile/user/quote_controller');
const {
  validateCreateQuoteBody,
  validateUpdateQuoteBody,
  validateQuoteIdParam,
  validateListQuotesQuery,
  validateCancelQuoteBody,
  validateConvertQuoteBody,
} = require('../../../middleware/mobile/user/quote_middleware');

router.post('/quotes/create', userAuthMiddleware, validateCreateQuoteBody, createQuoteHandler);
router.get('/quotes', userAuthMiddleware, validateListQuotesQuery, listQuotesHandler);
router.get('/quotes/:id', userAuthMiddleware, validateQuoteIdParam, getQuoteHandler);
router.put(
  '/quotes/:id',
  userAuthMiddleware,
  validateQuoteIdParam,
  validateUpdateQuoteBody,
  updateQuoteHandler
);
router.put(
  '/quotes/:id/cancel',
  userAuthMiddleware,
  validateQuoteIdParam,
  validateCancelQuoteBody,
  cancelQuoteHandler
);
router.post(
  '/quotes/:id/convert-to-order',
  userAuthMiddleware,
  validateQuoteIdParam,
  validateConvertQuoteBody,
  convertQuoteToOrderHandler
);

module.exports = router;
