const mongoose = require('mongoose');
const { normalizePostType } = require('../../../enum/post_type_enum');
const { MAX_IMAGES, MIN_IMAGES } = require('../../../services/partner_post_common_service');
const { parseBunnyVideoId } = require('../../../enum/post_media_enum');
const { fieldLabel } = require('../../../utils/field_labels');

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
    return sendError(res, 400, `${fieldLabel('post_type')} must be one of: order, legacy_work.`);
  }

  if (!description || String(description).trim() === '') {
    return sendError(res, 400, `${fieldLabel('description')} is required.`);
  }

  const files = req.files || [];
  const bunnyVideoId = parseBunnyVideoId(req.body?.bunny_video_id);

  if (bunnyVideoId && files.length > 0) {
    return sendError(res, 400, 'A post can have 1–4 images or 1 video, not both.');
  }

  if (bunnyVideoId) {
    return next();
  }

  if (files.length < MIN_IMAGES || files.length > MAX_IMAGES) {
    return sendError(res, 400, `Provide between ${MIN_IMAGES} and ${MAX_IMAGES} images.`);
  }

  next();
};

const validateUpdatePostBody = (req, res, next) => {
  const { description } = req.body || {};
  const files = req.files || [];
  const bunnyVideoId = parseBunnyVideoId(req.body?.bunny_video_id);

  if (description !== undefined && String(description).trim() === '') {
    return sendError(res, 400, `${fieldLabel('description')} cannot be empty.`);
  }

  if (files.length > MAX_IMAGES) {
    return sendError(res, 400, `You can upload at most ${MAX_IMAGES} new images per request.`);
  }

  if (bunnyVideoId && files.length > 0) {
    return sendError(res, 400, 'A post can have 1–4 images or 1 video, not both.');
  }

  next();
};

module.exports = {
  validatePostIdParam,
  validateCreatePostBody,
  validateUpdatePostBody,
};
