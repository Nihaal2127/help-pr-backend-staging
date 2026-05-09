const express = require('express');
const router = express.Router();
const {
    getAll,
    create,
    update,
    getById,
    deleteSubscriptionPlan,
    importRecords,
    getDropDown,
} = require('../controllers/subscription_plan_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {
    createSubscriptionPlanMiddleware,
    updateSubscriptionPlanMiddleware,
} = require('../middleware/subscription_plan_middleware');

router.use(rateLimiter);

router.post('/create', authMiddleware, createSubscriptionPlanMiddleware, create);
router.post('/imports', authMiddleware, importRecords);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll', authMiddleware, getAll);
router.get('/getDropDown', getDropDown);
router.put('/update/:id', authMiddleware, updateSubscriptionPlanMiddleware, update);
router.delete('/delete/:id', authMiddleware, deleteSubscriptionPlan);

module.exports = router;
