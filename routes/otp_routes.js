const express = require('express');
const router = express.Router();
const { sentOpt, verifyOtp} = require('../controllers/otp_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {rateLimitOtpRequests,validateOtp} = require('../middleware/otp_middleware');
// Apply rate limiting middleware to sensitive routes
router.use(rateLimiter);

// Public route: Get all users
// router.get('/', getUsers);

router.post('/send_otp',rateLimitOtpRequests ,rateLimiter, sentOpt);
router.post('/verify_otp', validateOtp, rateLimiter, verifyOtp);

// Protected route: Create a new user
//router.post('/', authMiddleware, userValidationRules, validate, createUser);

module.exports = router;