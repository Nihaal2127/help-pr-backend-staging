const express = require('express');
const router = express.Router();
const { razorpayCallback } = require('../controllers/razorpay_controller');

router.get('/callback', razorpayCallback);
module.exports = router;