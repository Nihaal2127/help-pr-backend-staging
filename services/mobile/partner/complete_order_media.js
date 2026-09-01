const { parseBunnyVideoId } = require('../../../enum/post_media_enum');

const MAX_IMAGES = 4;
const COMPLETE_MEDIA_MISSING_MESSAGE =
  'Provide 1–4 proof images, a bunny_video_id, or both.';

const inspectCompleteOrderMedia = (files, body) => {
  const imageFiles = Array.isArray(files) ? files : [];
  const rawVideo = String(body?.bunny_video_id ?? '').trim();
  const bunnyVideoId = parseBunnyVideoId(rawVideo);

  if (rawVideo && !bunnyVideoId) {
    return { error: 'Invalid bunny_video_id.' };
  }
  if (imageFiles.length > MAX_IMAGES) {
    return { error: `Provide at most ${MAX_IMAGES} proof images.` };
  }
  if (imageFiles.length === 0 && !bunnyVideoId) {
    return { error: COMPLETE_MEDIA_MISSING_MESSAGE };
  }

  return { imageFiles, bunnyVideoId };
};

module.exports = {
  COMPLETE_MEDIA_MISSING_MESSAGE,
  inspectCompleteOrderMedia,
};
