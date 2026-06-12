const {
  getPostCounts,
  listReports,
  listAllPosts,
  moderatePost,
  updateReportStatus,
} = require('../services/partner_post_service');

const getPostCountsHandler = async (req, res) => {
  try {
    const result = await getPostCounts(req, req.query);

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
      record: result.data.counts,
    });
  } catch (error) {
    console.error('admin partner post getCounts', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const listReportsHandler = async (req, res) => {
  try {
    const result = await listReports(req.query);

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
      records: result.data.data.records,
    });
  } catch (error) {
    console.error('admin partner post reports', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getAllPostsHandler = async (req, res) => {
  try {
    const result = await listAllPosts(req.query);

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
      records: result.data.data.records,
    });
  } catch (error) {
    console.error('admin partner post getAll', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const moderatePostHandler = async (req, res) => {
  try {
    const result = await moderatePost(req.params.postId, req.body);

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
      record: result.data.post,
    });
  } catch (error) {
    console.error('admin partner post moderate', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const updateReportHandler = async (req, res) => {
  try {
    const result = await updateReportStatus(req.params.reportId, req.body);

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
      record: result.data.report,
    });
  } catch (error) {
    console.error('admin partner post report update', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  getPostCountsHandler,
  listReportsHandler,
  getAllPostsHandler,
  moderatePostHandler,
  updateReportHandler,
};
