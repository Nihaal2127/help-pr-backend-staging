const express = require('express');
const router = express.Router();
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const { requirePartnerAccount } = require('../../../middleware/mobile/partner/quote_middleware');
const { validateOrderIdParam } = require('../../../middleware/mobile/partner/order_middleware');
const {
    listFinancialPaymentsHandler,
    getFinancialPaymentHandler,
    getWalletSummaryHandler,
    listWalletTransactionsHandler,
} = require('../../../controllers/mobile/partner/financial_wallet_controller');

router.use(partnerAuthMiddleware, requirePartnerAccount);

router.get('/financial-payments', listFinancialPaymentsHandler);
router.get('/financial-payments/:orderId', validateOrderIdParam, getFinancialPaymentHandler);
router.get('/wallet', getWalletSummaryHandler);
router.get('/wallet/transactions', listWalletTransactionsHandler);

module.exports = router;
