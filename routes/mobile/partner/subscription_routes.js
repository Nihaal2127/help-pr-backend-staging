const express = require('express');
const router = express.Router();
const {
    getSummary,
    previewChange,
    applyChange,
    listHistory,
    getChangePaymentStatus,
    verifyApplePurchase,
    restoreApplePurchase,
} = require('../../../controllers/mobile/partner/subscription_change_controller');
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const { requirePartnerAccount } = require('../../../middleware/mobile/partner/quote_middleware');
const {
    validateTargetPlanId,
    validateApplyChangeBody,
    validateAppleVerifyBody,
    validateAppleRestoreBody,
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
router.post(
    '/subscription/apple/verify',
    partnerAuthMiddleware,
    requirePartnerAccount,
    validateAppleVerifyBody,
    verifyApplePurchase
);
router.post(
    '/subscription/apple/restore',
    partnerAuthMiddleware,
    requirePartnerAccount,
    validateAppleRestoreBody,
    restoreApplePurchase
);

module.exports = router;
