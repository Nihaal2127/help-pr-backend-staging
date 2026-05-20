const express = require('express');
const router = express.Router();
const {
    getAll,
    getEligibleOrders,
    getById,
    create,
} = require('../controllers/refund_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {
    createRefundMiddleware,
    validateRefundIdParam,
} = require('../middleware/refund_middleware');

router.use(rateLimiter);

router.get('/getAll', authMiddleware, getAll);
router.get('/eligible-orders', authMiddleware, getEligibleOrders);
router.get('/getById/:id', authMiddleware, validateRefundIdParam, getById);
router.post('/create', authMiddleware, createRefundMiddleware, create);

module.exports = router;
