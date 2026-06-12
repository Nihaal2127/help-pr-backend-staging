const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const { requireBackoffice } = require('../middleware/role_middleware');
const {
  validatePostIdParam,
  validateReportIdParam,
  validateModeratePostBody,
  validateUpdateReportBody,
} = require('../middleware/partner_post_middleware');
const {
  getPostCountsHandler,
  listReportsHandler,
  getAllPostsHandler,
  moderatePostHandler,
  updateReportHandler,
} = require('../controllers/partner_post_controller');

router.use(rateLimiter);
router.use(authMiddleware, requireBackoffice);

router.get('/getCounts', getPostCountsHandler);
router.get('/reports', listReportsHandler);
router.get('/getAll', getAllPostsHandler);
router.put(
  '/moderate/:postId',
  validatePostIdParam,
  validateModeratePostBody,
  moderatePostHandler
);
router.put(
  '/reports/:reportId',
  validateReportIdParam,
  validateUpdateReportBody,
  updateReportHandler
);

module.exports = router;
