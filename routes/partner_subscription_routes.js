const express = require('express');
const router = express.Router();
const {
    getAll,
    create,
    update,
    getById,
    deletePartnerSubscription,
    importRecords,
    getMine,
    getSubscriptionPlans,
} = require('../controllers/partner_subscription_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const { requirePartner } = require('../middleware/role_middleware');
const {
    createPartnerSubscriptionMiddleware,
    updatePartnerSubscriptionMiddleware,
    requirePartnerSubscriptionManagement,
} = require('../middleware/partner_subscription_middleware');

router.use(rateLimiter);

router.get('/me', authMiddleware, requirePartner, getMine);

router.post(
    '/create',
    authMiddleware,
    requirePartnerSubscriptionManagement,
    createPartnerSubscriptionMiddleware,
    create
);
router.post('/imports', authMiddleware, requirePartnerSubscriptionManagement, importRecords);
router.get('/getAll', authMiddleware, requirePartnerSubscriptionManagement, getAll);
router.get(
    '/getSubscriptionPlans',
    authMiddleware,
    requirePartnerSubscriptionManagement,
    getSubscriptionPlans
);
router.get('/get/:id', authMiddleware, requirePartnerSubscriptionManagement, getById);
router.put(
    '/update/:id',
    authMiddleware,
    requirePartnerSubscriptionManagement,
    updatePartnerSubscriptionMiddleware,
    update
);
router.delete('/delete/:id', authMiddleware, requirePartnerSubscriptionManagement, deletePartnerSubscription);

module.exports = router;
