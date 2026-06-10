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
  listLikedPostsHandler,
  listSavedPostsHandler,
  getPostHandler,
  resolveShareTokenHandler,
  toggleLikeHandler,
  savePostHandler,
  unsavePostHandler,
  sharePostHandler,
  reportPostHandler,
} = require('../../../controllers/mobile/user/post_controller');

router.get('/posts/share/:shareToken', validateShareTokenParam, resolveShareTokenHandler);

router.get('/posts/feed', userAuthMiddleware, validateFranchiseIdQuery, listFeedHandler);
router.get('/posts/liked', userAuthMiddleware, listLikedPostsHandler);
router.get('/posts/saved', userAuthMiddleware, listSavedPostsHandler);
router.get(
  '/partners/:partnerId/posts',
  userAuthMiddleware,
  validatePartnerIdParam,
  validateFranchiseIdQuery,
  listPartnerPostsHandler
);
router.get('/posts/:postId', userAuthMiddleware, validatePostIdParam, getPostHandler);
router.post('/posts/:postId/like', userAuthMiddleware, validatePostIdParam, toggleLikeHandler);
router.post('/posts/:postId/save', userAuthMiddleware, validatePostIdParam, savePostHandler);
router.delete('/posts/:postId/save', userAuthMiddleware, validatePostIdParam, unsavePostHandler);
router.post('/posts/:postId/share', userAuthMiddleware, validatePostIdParam, sharePostHandler);
router.post(
  '/posts/:postId/report',
  userAuthMiddleware,
  validatePostIdParam,
  validateReportBody,
  reportPostHandler
);

module.exports = router;
