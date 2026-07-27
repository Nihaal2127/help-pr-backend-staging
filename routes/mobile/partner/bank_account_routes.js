const express = require('express');
const router = express.Router();
const {
  listHandler,
  createHandler,
  updateHandler,
  setPrimaryHandler,
  deleteHandler,
} = require('../../../controllers/mobile/partner/bank_account_controller');
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const { requirePartnerAccount } = require('../../../middleware/mobile/partner/quote_middleware');
const {
  partnerBankAccountApprovedMiddleware,
  partnerValidateBankAccountIdMiddleware,
  partnerCreateBankAccountMiddleware,
  partnerUpdateBankAccountMiddleware,
} = require('../../../middleware/mobile/partner/bank_account_middleware');

const partnerOnly = [partnerAuthMiddleware, requirePartnerAccount];

router.get('/bank-accounts/get', ...partnerOnly, listHandler);
router.post(
  '/bank-accounts/create',
  ...partnerOnly,
  partnerCreateBankAccountMiddleware,
  createHandler
);
router.put(
  '/bank-accounts/update/:id',
  ...partnerOnly,
  partnerValidateBankAccountIdMiddleware,
  partnerUpdateBankAccountMiddleware,
  updateHandler
);
router.patch(
  '/bank-accounts/:id/set-primary',
  ...partnerOnly,
  partnerValidateBankAccountIdMiddleware,
  partnerBankAccountApprovedMiddleware,
  setPrimaryHandler
);
router.delete(
  '/bank-accounts/delete/:id',
  ...partnerOnly,
  partnerValidateBankAccountIdMiddleware,
  partnerBankAccountApprovedMiddleware,
  deleteHandler
);

module.exports = router;
