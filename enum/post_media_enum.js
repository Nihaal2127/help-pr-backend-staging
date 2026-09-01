const POST_MEDIA_TYPE_IMAGE = 'image';
const POST_MEDIA_TYPE_VIDEO = 'video';
const POST_MEDIA_TYPES = [POST_MEDIA_TYPE_IMAGE, POST_MEDIA_TYPE_VIDEO];

const VIDEO_STATUS_PROCESSING = 'processing';
const VIDEO_STATUS_READY = 'ready';
const VIDEO_STATUS_FAILED = 'failed';
const VIDEO_STATUSES = [VIDEO_STATUS_PROCESSING, VIDEO_STATUS_READY, VIDEO_STATUS_FAILED];

const MAX_VIDEO_DURATION_SECONDS = 60;
const VIDEO_UPLOAD_SESSION_TTL_SECONDS = 60 * 60;

const normalizeMediaType = (raw) => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (POST_MEDIA_TYPES.includes(s)) return s;
  return null;
};

const BUNNY_VIDEO_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseBunnyVideoId = (raw) => {
  const value = String(raw ?? '').trim();
  if (!value || !BUNNY_VIDEO_ID_PATTERN.test(value)) return null;
  return value;
};

module.exports = {
  POST_MEDIA_TYPE_IMAGE,
  POST_MEDIA_TYPE_VIDEO,
  POST_MEDIA_TYPES,
  VIDEO_STATUS_PROCESSING,
  VIDEO_STATUS_READY,
  VIDEO_STATUS_FAILED,
  VIDEO_STATUSES,
  MAX_VIDEO_DURATION_SECONDS,
  VIDEO_UPLOAD_SESSION_TTL_SECONDS,
  normalizeMediaType,
  parseBunnyVideoId,
};
