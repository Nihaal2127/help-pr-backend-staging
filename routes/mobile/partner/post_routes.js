const express = require('express');
const router = express.Router();
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const { requirePartnerAccount } = require('../../../middleware/mobile/partner/quote_middleware');
const {
  validatePostIdParam,
  validateCreatePostBody,
  validateUpdatePostBody,
} = require('../../../middleware/mobile/partner/post_middleware');
const {
  createPostHandler,
  listPostsHandler,
  listOrderOptionsHandler,
  getPostHandler,
  updatePostHandler,
  deletePostHandler,
} = require('../../../controllers/mobile/partner/post_controller');
const { uploadImages } = require('../../../utils/fileUpload');
const { wrapMulterUpload } = require('../../../utils/multer_error_handler');

const postImagesUpload = wrapMulterUpload(uploadImages.array('images', 4));

router.use(partnerAuthMiddleware, requirePartnerAccount);

router.get('/posts/order-options', listOrderOptionsHandler);
router.post('/posts', postImagesUpload, validateCreatePostBody, createPostHandler);
router.get('/posts', listPostsHandler);
router.get('/posts/:postId', validatePostIdParam, getPostHandler);
router.put(
  '/posts/:postId',
  postImagesUpload,
  validatePostIdParam,
  validateUpdatePostBody,
  updatePostHandler
);
router.delete('/posts/:postId', validatePostIdParam, deletePostHandler);

module.exports = router;
