const express = require('express');
const partnerRoutes = require('./partner');
const userRoutes = require('./user');

const router = express.Router();

router.use('/partner', partnerRoutes);
router.use('/user', userRoutes);

module.exports = router;
