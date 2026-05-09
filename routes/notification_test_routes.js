const express = require('express');
const router = express.Router();
const { send_notification} = require('../controllers/notification_test');
const authMiddleware = require('../middleware/auth_middleware');
// Apply rate limiting middleware to sensitive routes



router.post('/send',send_notification);
module.exports = router;