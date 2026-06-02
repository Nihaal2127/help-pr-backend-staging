const {
  createPartnerPost,
  listPartnerPosts,
  listOrderOptions,
  getPartnerPostById,
  updatePartnerPost,
  deletePartnerPost,
} = require('../../../services/mobile/partner/post_service');

const createPostHandler = async (req, res) => {
  try {
    const result = await createPartnerPost(req.user.id, req.body, req.files);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(result.status).json({
      success: true,
      status: result.status,
      message: result.data.message,
      data: result.data.post,
    });
  } catch (error) {
    console.error('mobile partner create post', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const listPostsHandler = async (req, res) => {
  try {
    const result = await listPartnerPosts(req.user.id, req.query);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      totalItems: result.data.data.totalItems,
      totalPages: result.data.data.totalPages,
      currentPage: result.data.data.currentPage,
      limit: result.data.data.limit,
      data: { records: result.data.data.records },
    });
  } catch (error) {
    console.error('mobile partner list posts', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const listOrderOptionsHandler = async (req, res) => {
  try {
    const result = await listOrderOptions(req.user.id, req.query);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      totalItems: result.data.data.totalItems,
      totalPages: result.data.data.totalPages,
      currentPage: result.data.data.currentPage,
      limit: result.data.data.limit,
      data: { records: result.data.data.records },
    });
  } catch (error) {
    console.error('mobile partner post order options', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getPostHandler = async (req, res) => {
  try {
    const result = await getPartnerPostById(req.user.id, req.params.postId);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      data: result.data.post,
    });
  } catch (error) {
    console.error('mobile partner get post', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const updatePostHandler = async (req, res) => {
  try {
    const result = await updatePartnerPost(
      req.user.id,
      req.params.postId,
      req.body,
      req.files
    );

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      data: result.data.post,
    });
  } catch (error) {
    console.error('mobile partner update post', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const deletePostHandler = async (req, res) => {
  try {
    const result = await deletePartnerPost(req.user.id, req.params.postId);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
    });
  } catch (error) {
    console.error('mobile partner delete post', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  createPostHandler,
  listPostsHandler,
  listOrderOptionsHandler,
  getPostHandler,
  updatePostHandler,
  deletePostHandler,
};
