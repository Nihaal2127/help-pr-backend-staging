const express = require('express');
const partnerRoutes = require('./partner/partner_routes');
const locationRoutes = require('./partner/location_routes');
const userRoutes = require('./user');
const mobileRateLimiter = require('../../middleware/mobile/rate_middleware');

const router = express.Router();

router.use(mobileRateLimiter);

router.use('/partner', partnerRoutes);
router.use('/partner', locationRoutes);
router.use('/user', userRoutes);

module.exports = router;
