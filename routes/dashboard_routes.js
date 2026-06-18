const express = require('express');
const router = express.Router();
const { getDashboardData, getAdminDashboardStats } = require('../controllers/dashboard_controller');
const authMiddleware = require('../middleware/auth_middleware');
const { requireBackoffice } = require('../middleware/role_middleware');

router.get('/getData', authMiddleware, getDashboardData);
router.get('/stats', authMiddleware, requireBackoffice, getAdminDashboardStats);

module.exports = router;