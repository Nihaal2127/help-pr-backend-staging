const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const { requirePartner, requireBackoffice } = require('../middleware/role_middleware');
const { getMyCategories, getAll } = require('../controllers/partner_category_controller');

router.use(rateLimiter);

router.get('/myCategories', authMiddleware, requirePartner, getMyCategories);
router.get('/getAll', authMiddleware, requireBackoffice, getAll);

module.exports = router;
