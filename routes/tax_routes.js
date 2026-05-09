const express = require('express');
const router = express.Router();
const { create,update,get,} = require('../controllers/tax_controller');
const authMiddleware = require('../middleware/auth_middleware');
// const rateLimiter = require('../middleware/rate_middleware');
const {createTaxMiddleware, updateTaxMiddleware} = require('../middleware/tax_middleware');
// Apply rate limiting middleware to sensitive routes

// router.use(rateLimiter);

router.post('/create', authMiddleware, createTaxMiddleware, create);
router.get('/get', authMiddleware, get);
router.put('/update/:id',authMiddleware,updateTaxMiddleware,update);

module.exports = router;