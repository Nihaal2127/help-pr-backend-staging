const express = require('express');
const router = express.Router();
const userAuthMiddleware = require('../../../middleware/mobile/user/user_auth_middleware');
const {
  validateFranchiseIdQuery,
  validatePostIdParam,
  validatePartnerIdParam,
  validateShareTokenParam,
  validateReportBody,
} = require('../../../middleware/mobile/user/post_middleware');
const {
  listFeedHandler,
  listPartnerPostsHandler,
  getPostHandler,
  resolveShareTokenHandler,
  toggleLikeHandler,
  sharePostHandler,
  reportPostHandler,
} = require('../../../controllers/mobile/user/post_controller');

router.get('/posts/share/:shareToken', validateShareTokenParam, resolveShareTokenHandler);

router.use(userAuthMiddleware);

router.get('/posts/feed', validateFranchiseIdQuery, listFeedHandler);
router.get(
  '/partners/:partnerId/posts',
  validatePartnerIdParam,
  validateFranchiseIdQuery,
  listPartnerPostsHandler
);
router.get('/posts/:postId', validatePostIdParam, getPostHandler);
router.post('/posts/:postId/like', validatePostIdParam, toggleLikeHandler);
router.post('/posts/:postId/share', validatePostIdParam, sharePostHandler);
router.post('/posts/:postId/report', validatePostIdParam, validateReportBody, reportPostHandler);

module.exports = router;
