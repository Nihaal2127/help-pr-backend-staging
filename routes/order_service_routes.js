const express = require('express');
const router = express.Router();
const { getAll, create,  getById,payComission} = require('../controllers/order_service_controller');
const authMiddleware = require('../middleware/auth_middleware');
// const rateLimiter = require('../middleware/rate_middleware');
const {payComissionMiddleware} = require('../middleware/order_middleware');
// Apply rate limiting middleware to sensitive routes

// router.use(rateLimiter);
router.get('/getAll', authMiddleware, getAll);
router.post('/payComission', authMiddleware,payComissionMiddleware, payComission);
router.get('/get/:id', authMiddleware, getById);
module.exports = router;