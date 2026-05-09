const express = require('express');
const router = express.Router();
const { getDashboardData } = require('../controllers/dashboard_controller');
const authMiddleware = require('../middleware/auth_middleware');



router.get('/getData', authMiddleware, getDashboardData);
module.exports = router;