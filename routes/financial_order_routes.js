const express = require('express');
const router = express.Router();
const {
    getAll,
    create,
    update,
    getById,
    deleteFinancialOrder,
} = require('../controllers/financial_order_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {
    validateFinancialOrderIdParam,
    createFinancialOrderMiddleware,
    updateFinancialOrderMiddleware,
} = require('../middleware/financial_order_middleware');

router.use(rateLimiter);

router.post('/create', authMiddleware, createFinancialOrderMiddleware, create);
router.get('/getAll', authMiddleware, getAll);
router.get('/get/:id', authMiddleware, validateFinancialOrderIdParam, getById);
router.put('/update/:id', authMiddleware, validateFinancialOrderIdParam, updateFinancialOrderMiddleware, update);
router.delete('/delete/:id', authMiddleware, validateFinancialOrderIdParam, deleteFinancialOrder);

module.exports = router;
