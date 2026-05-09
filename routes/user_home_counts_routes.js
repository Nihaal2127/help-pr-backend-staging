const express = require('express');
const router = express.Router();
const { create, update, get, } = require('../controllers/user_home_counts_controller');
const authMiddleware = require('../middleware/auth_middleware');
const { createUserHomeCountsMiddleware, updateUserHomeCountsMiddleware } = require('../middleware/user_home_counts_middleware');

router.post('/create', authMiddleware, createUserHomeCountsMiddleware, create);
router.get('/get', authMiddleware, get);
router.put('/update/:id', authMiddleware, updateUserHomeCountsMiddleware, update);

module.exports = router;