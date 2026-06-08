const express = require('express');
const router = express.Router();
const { listHandler } = require('../../../controllers/mobile/partner/bank_account_controller');
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const { requirePartnerAccount } = require('../../../middleware/mobile/partner/quote_middleware');

router.get('/bank-accounts/get', partnerAuthMiddleware, requirePartnerAccount, listHandler);

module.exports = router;
