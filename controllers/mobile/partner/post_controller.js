const {
  createPartnerPost,
  listPartnerPosts,
  listOrderOptions,
  getPartnerPostById,
  updatePartnerPost,
  deletePartnerPost,
} = require('../../../services/mobile/partner/post_service');
const {
  wrapMobileHandler,
  sendServiceError,
  sendPaginatedListWithNestedData,
  sendStatusPayloadResult,
} = require('../../../utils/mobile_controller_helpers');

const createPostHandler = wrapMobileHandler('mobile partner create post', async (req, res) => {
  const result = await createPartnerPost(req.user.id, req.body, req.files);
  return sendStatusPayloadResult(res, result, (r) => ({
    message: r.data.message,
    data: r.data.post,
  }));
});

const listPostsHandler = wrapMobileHandler('mobile partner list posts', async (req, res) => {
  const result = await listPartnerPosts(req.user.id, req.query);
  return sendPaginatedListWithNestedData(res, result, (listData) => ({
    records: listData.records,
  }));
});

const listOrderOptionsHandler = wrapMobileHandler('mobile partner post order options', async (req, res) => {
  const result = await listOrderOptions(req.user.id, req.query);
  return sendPaginatedListWithNestedData(res, result, (listData) => ({
    records: listData.records,
  }));
});

const getPostHandler = wrapMobileHandler('mobile partner get post', async (req, res) => {
  const result = await getPartnerPostById(req.user.id, req.params.postId);
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

const updatePostHandler = wrapMobileHandler('mobile partner update post', async (req, res) => {
  const result = await updatePartnerPost(req.user.id, req.params.postId, req.body, req.files);
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

const deletePostHandler = wrapMobileHandler('mobile partner delete post', async (req, res) => {
  const result = await deletePartnerPost(req.user.id, req.params.postId);
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
  createPostHandler,
  listPostsHandler,
  listOrderOptionsHandler,
  getPostHandler,
  updatePostHandler,
  deletePostHandler,
};
