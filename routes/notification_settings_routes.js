const express = require('express');
const router = express.Router();
const {update,  getById} = require('../controllers/notification_settings_controller');
const authMiddleware = require('../middleware/auth_middleware');


router.get('/get/:id', authMiddleware, getById);
router.put('/update/:id',authMiddleware,update);

module.exports = router;