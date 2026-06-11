const express = require('express');
const partnerRoutes = require('./partner/partner_routes');
const myServicesRoutes = require('./partner/my_services_routes');
const bankAccountRoutes = require('./partner/bank_account_routes');
const financialWalletRoutes = require('./partner/financial_wallet_routes');
const subscriptionRoutes = require('./partner/subscription_routes');
const locationRoutes = require('./common/location_routes');
const userRoutes = require('./user/user_routes');
const commonRateLimiter = require('../../middleware/mobile/common/common_rate_middleware');
const partnerRateLimiter = require('../../middleware/mobile/partner/partner_rate_middleware');
const userRateLimiter = require('../../middleware/mobile/user/user_rate_middleware');

const router = express.Router();

router.use(commonRateLimiter, locationRoutes);
router.use('/partner', partnerRateLimiter, partnerRoutes);
router.use('/partner', partnerRateLimiter, myServicesRoutes);
router.use('/partner', partnerRateLimiter, bankAccountRoutes);
router.use('/partner', partnerRateLimiter, financialWalletRoutes);
router.use('/partner', partnerRateLimiter, subscriptionRoutes);
router.use('/user', userRateLimiter, userRoutes);

module.exports = router;
