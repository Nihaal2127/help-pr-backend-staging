const express = require('express');
const router = express.Router();
const { create, update, get } = require('../controllers/quote_settings_controller');
const authMiddleware = require('../middleware/auth_middleware');
const { requireSuperAdminOrStaff } = require('../middleware/role_middleware');
const {
    createQuoteSettingsMiddleware,
    updateQuoteSettingsMiddleware,
} = require('../middleware/quote_settings_middleware');

router.post('/create', authMiddleware, requireSuperAdminOrStaff, createQuoteSettingsMiddleware, create);
router.get('/get', authMiddleware, requireSuperAdminOrStaff, get);
router.put('/update/:id', authMiddleware, requireSuperAdminOrStaff, updateQuoteSettingsMiddleware, update);

module.exports = router;
