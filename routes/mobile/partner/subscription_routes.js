const express = require('express');
const router = express.Router();
const {
    getSummary,
    previewChange,
    applyChange,
    listHistory,
    getChangePaymentStatus,
} = require('../../../controllers/mobile/partner/subscription_change_controller');
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const { requirePartnerAccount } = require('../../../middleware/mobile/partner/quote_middleware');
const {
    validateTargetPlanId,
    validateApplyChangeBody,
} = require('../../../middleware/mobile/partner/subscription_change_middleware');

router.get('/subscription', partnerAuthMiddleware, requirePartnerAccount, getSummary);
router.get('/subscription/changes', partnerAuthMiddleware, requirePartnerAccount, listHistory);
router.post(
    '/subscription/change/preview',
    partnerAuthMiddleware,
    requirePartnerAccount,
    validateTargetPlanId,
    previewChange
);
router.post(
    '/subscription/change',
    partnerAuthMiddleware,
    requirePartnerAccount,
    validateApplyChangeBody,
    applyChange
);
router.get(
    '/subscription/change/:changeId/payment-status',
    partnerAuthMiddleware,
    requirePartnerAccount,
    getChangePaymentStatus
);

module.exports = router;
