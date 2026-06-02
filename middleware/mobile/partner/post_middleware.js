const mongoose = require('mongoose');
const { normalizePostType } = require('../../../enum/post_type_enum');
const { MAX_IMAGES, MIN_IMAGES } = require('../../../services/partner_post_common_service');

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validatePostIdParam = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.postId))) {
    return sendError(res, 400, 'Invalid post id.');
  }
  next();
};

const validateCreatePostBody = (req, res, next) => {
  const { post_type, description } = req.body || {};

  if (!normalizePostType(post_type)) {
    return sendError(res, 400, 'post_type must be one of: order, legacy_work.');
  }

  if (!description || String(description).trim() === '') {
    return sendError(res, 400, 'description is required.');
  }

  const files = req.files || [];
  if (files.length < MIN_IMAGES || files.length > MAX_IMAGES) {
    return sendError(res, 400, `Provide between ${MIN_IMAGES} and ${MAX_IMAGES} images.`);
  }

  next();
};

const validateUpdatePostBody = (req, res, next) => {
  const { description } = req.body || {};
  const files = req.files || [];

  if (description !== undefined && String(description).trim() === '') {
    return sendError(res, 400, 'description cannot be empty.');
  }

  if (files.length > MAX_IMAGES) {
    return sendError(res, 400, `You can upload at most ${MAX_IMAGES} new images per request.`);
  }

  next();
};

module.exports = {
  validatePostIdParam,
  validateCreatePostBody,
  validateUpdatePostBody,
};
