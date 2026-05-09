const express = require('express');
const router = express.Router();
const { getAll, create,update,  getById,  deleteAccount,changePrimaryAccount} = require('../controllers/partner_bank_account_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {createBankAccountMiddleware, updateBankAccountMiddleware} = require('../middleware/partner_bank_account_middleware');
// Apply rate limiting middleware to sensitive routes

router.use(rateLimiter);

router.post('/create', authMiddleware, createBankAccountMiddleware, create);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll', authMiddleware, getAll);
router.put('/update/:id',authMiddleware,updateBankAccountMiddleware,update);
router.post('/changePrimaryAccount/:id', authMiddleware, changePrimaryAccount);
router.delete('/delete/:id',authMiddleware, deleteAccount);
module.exports = router;