const express = require('express');
const router = express.Router();
const {handleRazorpayWebhook , razorpayCallback } = require('../controllers/razorpay_controller');

router.post('/razorpayWebhook', handleRazorpayWebhook);
router.get('/callback', razorpayCallback);
module.exports = router;