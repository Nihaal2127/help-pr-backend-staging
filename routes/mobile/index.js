const express = require('express');
const partnerRoutes = require('./partner/partner_routes');
const myServicesRoutes = require('./partner/my_services_routes');
const locationRoutes = require('./partner/location_routes');
const userRoutes = require('./user/user_routes');
const partnerRateLimiter = require('../../middleware/mobile/partner/partner_rate_middleware');
const userRateLimiter = require('../../middleware/mobile/user/user_rate_middleware');

const router = express.Router();

router.use('/partner', partnerRateLimiter, partnerRoutes);
router.use('/partner', partnerRateLimiter, myServicesRoutes);
router.use('/partner', partnerRateLimiter, locationRoutes);
router.use('/user', userRateLimiter, userRoutes);

module.exports = router;
