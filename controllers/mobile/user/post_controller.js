const {
  listPostsFeed,
  listPartnerProfilePosts,
  getPostDetail,
  resolvePostByShareToken,
  togglePostLike,
  recordPostShare,
  reportPost,
} = require('../../../services/mobile/user/post_service');

const listFeedHandler = async (req, res) => {
  try {
    const result = await listPostsFeed(req.user.id, req.query);

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
      data: {
        franchise_id: result.data.data.franchise_id,
        franchise_name: result.data.data.franchise_name,
        records: result.data.data.records,
      },
    });
  } catch (error) {
    console.error('mobile user posts feed', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const listPartnerPostsHandler = async (req, res) => {
  try {
    const result = await listPartnerProfilePosts(
      req.user.id,
      req.params.partnerId,
      req.query
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
      totalItems: result.data.data.totalItems,
      totalPages: result.data.data.totalPages,
      currentPage: result.data.data.currentPage,
      limit: result.data.data.limit,
      data: {
        partner_id: result.data.data.partner_id,
        records: result.data.data.records,
      },
    });
  } catch (error) {
    console.error('mobile user partner posts', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getPostHandler = async (req, res) => {
  try {
    const result = await getPostDetail(req.user.id, req.params.postId, req.query.franchise_id);

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
    console.error('mobile user get post', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const resolveShareTokenHandler = async (req, res) => {
  try {
    const result = await resolvePostByShareToken(req.params.shareToken);

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
      data: {
        post: result.data.post,
        share_url: result.data.share_url,
      },
    });
  } catch (error) {
    console.error('mobile user resolve share token', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const toggleLikeHandler = async (req, res) => {
  try {
    const result = await togglePostLike(req.user.id, req.params.postId);

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
      data: result.data.data,
    });
  } catch (error) {
    console.error('mobile user toggle post like', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const sharePostHandler = async (req, res) => {
  try {
    const result = await recordPostShare(req.user.id, req.params.postId);

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
      data: result.data.data,
    });
  } catch (error) {
    console.error('mobile user share post', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const reportPostHandler = async (req, res) => {
  try {
    const result = await reportPost(req.user.id, req.params.postId, req.body);

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
    console.error('mobile user report post', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  listFeedHandler,
  listPartnerPostsHandler,
  getPostHandler,
  resolveShareTokenHandler,
  toggleLikeHandler,
  sharePostHandler,
  reportPostHandler,
};
