const {
  listPostsFeed,
  listPartnerProfilePosts,
  listLikedPosts,
  listSavedPosts,
  getPostDetail,
  resolvePostByShareToken,
  togglePostLike,
  savePostForCustomer,
  unsavePostForCustomer,
  recordPostShare,
  reportPost,
} = require('../../../services/mobile/user/post_service');
const {
  wrapMobileHandler,
  sendServiceError,
  sendPaginatedListWithNestedData,
  sendCreatedOrOkDataResult,
  sendDataResult,
} = require('../../../utils/mobile_controller_helpers');

const buildPaginatedPostsHandler = (serviceFn, logLabel) =>
  wrapMobileHandler(logLabel, async (req, res) => {
    const result = await serviceFn(req.user.id, req.query);
    return sendPaginatedListWithNestedData(res, result, (listData) => ({
      records: listData.records,
    }));
  });

const listFeedHandler = wrapMobileHandler('mobile user posts feed', async (req, res) => {
  const result = await listPostsFeed(req.user.id, req.query);
  return sendPaginatedListWithNestedData(res, result, (listData) => ({
    franchise_id: listData.franchise_id,
    franchise_name: listData.franchise_name,
    records: listData.records,
  }));
});

const listPartnerPostsHandler = wrapMobileHandler('mobile user partner posts', async (req, res) => {
  const result = await listPartnerProfilePosts(req.user.id, req.params.partnerId, req.query);
  return sendPaginatedListWithNestedData(res, result, (listData) => ({
    partner_id: listData.partner_id,
    records: listData.records,
  }));
});

const getPostHandler = wrapMobileHandler('mobile user get post', async (req, res) => {
  const result = await getPostDetail(req.user.id, req.params.postId, req.query.franchise_id);
  if (!result.ok) {
    return sendServiceError(res, result);
  }
  return res.status(200).json({
    success: true,
    status: 200,
    message: result.data.message,
    data: result.data.post,
  });
});

const resolveShareTokenHandler = wrapMobileHandler('mobile user resolve share token', async (req, res) => {
  const result = await resolvePostByShareToken(req.params.shareToken);
  if (!result.ok) {
    return sendServiceError(res, result);
  }
  return res.status(200).json({
    success: true,
    status: 200,
    message: result.data.message,
    data: {
      post: result.data.post,
      share_url: result.data.share_url,
    },
  });
});

const listLikedPostsHandler = buildPaginatedPostsHandler(listLikedPosts, 'mobile user liked posts');
const listSavedPostsHandler = buildPaginatedPostsHandler(listSavedPosts, 'mobile user saved posts');

const savePostHandler = wrapMobileHandler('mobile user save post', async (req, res) => {
  const result = await savePostForCustomer(req.user.id, req.params.postId);
  return sendCreatedOrOkDataResult(res, result, 'Post saved successfully.');
});

const unsavePostHandler = wrapMobileHandler('mobile user unsave post', async (req, res) => {
  const result = await unsavePostForCustomer(req.user.id, req.params.postId);
  return sendDataResult(res, result);
});

const toggleLikeHandler = wrapMobileHandler('mobile user toggle post like', async (req, res) => {
  const result = await togglePostLike(req.user.id, req.params.postId);
  return sendDataResult(res, result);
});

const sharePostHandler = wrapMobileHandler('mobile user share post', async (req, res) => {
  const result = await recordPostShare(req.user.id, req.params.postId);
  return sendDataResult(res, result);
});

const reportPostHandler = wrapMobileHandler('mobile user report post', async (req, res) => {
  const result = await reportPost(req.user.id, req.params.postId, req.body);
  if (!result.ok) {
    return sendServiceError(res, result);
  }
  return res.status(200).json({
    success: true,
    status: 200,
    message: result.data.message,
  });
});

module.exports = {
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
};
