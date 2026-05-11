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
const { requireAdmin, requirePartner } = require('../middleware/role_middleware');
const {
    createPartnerSubscriptionMiddleware,
    updatePartnerSubscriptionMiddleware,
} = require('../middleware/partner_subscription_middleware');

router.use(rateLimiter);

router.get('/me', authMiddleware, requirePartner, getMine);

router.post('/create', authMiddleware, requireAdmin, createPartnerSubscriptionMiddleware, create);
router.post('/imports', authMiddleware, requireAdmin, importRecords);
router.get('/getAll', authMiddleware, requireAdmin, getAll);
router.get('/getSubscriptionPlans', authMiddleware, requireAdmin, getSubscriptionPlans);
router.get('/get/:id', authMiddleware, requireAdmin, getById);
router.put('/update/:id', authMiddleware, requireAdmin, updatePartnerSubscriptionMiddleware, update);
router.delete('/delete/:id', authMiddleware, requireAdmin, deletePartnerSubscription);

module.exports = router;
