const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const { requireBackoffice } = require('../middleware/role_middleware');
const {
  validatePartnerIdParam,
  validatePartnerProfileQuery,
} = require('../middleware/partners_middleware');
const {
  getPartnersCountsHandler,
  listPartnersHandler,
  getPartnerProfileHandler,
} = require('../controllers/partners_controller');

router.use(rateLimiter);
router.use(authMiddleware, requireBackoffice);

router.get('/getCounts', getPartnersCountsHandler);
router.get('/', listPartnersHandler);
router.get(
  '/:partnerId',
  validatePartnerIdParam,
  validatePartnerProfileQuery,
  getPartnerProfileHandler
);

module.exports = router;
