const express = require('express');
const router = express.Router();
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const {
  listQuotesHandler,
  getQuoteHandler,
  updateQuoteStatusHandler,
} = require('../../../controllers/mobile/partner/quote_controller');
const {
  requirePartnerAccount,
  validateQuoteIdParam,
  validateListPartnerQuotesQuery,
  validatePartnerStatusBody,
} = require('../../../middleware/mobile/partner/quote_middleware');

router.use(partnerAuthMiddleware, requirePartnerAccount);

router.get('/quotes', validateListPartnerQuotesQuery, listQuotesHandler);
router.get('/quotes/:id', validateQuoteIdParam, getQuoteHandler);
router.put(
  '/quotes/:id/status',
  validateQuoteIdParam,
  validatePartnerStatusBody,
  updateQuoteStatusHandler
);

module.exports = router;
