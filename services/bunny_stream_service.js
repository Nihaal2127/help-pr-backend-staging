const crypto = require('crypto');
const axios = require('axios');
const { MAX_VIDEO_DURATION_SECONDS } = require('../enum/post_media_enum');

const BUNNY_STREAM_API_BASE = 'https://video.bunnycdn.com';
const BUNNY_TUS_ENDPOINT = 'https://video.bunnycdn.com/tusupload';

const BUNNY_WEBHOOK_STATUS_FINISHED = 3;
const BUNNY_WEBHOOK_STATUS_RESOLUTION_FINISHED = 4;
const BUNNY_WEBHOOK_STATUS_FAILED = 5;
const BUNNY_WEBHOOK_STATUS_PRESIGNED_UPLOAD_FAILED = 8;

const BUNNY_VIDEO_STATUS_FINISHED = 4;
const BUNNY_VIDEO_STATUS_ERROR = 5;
const BUNNY_VIDEO_STATUS_UPLOAD_FAILED = 6;

const getLibraryId = () => String(process.env.BUNNY_STREAM_LIBRARY_ID || '').trim();
const getApiKey = () => String(process.env.BUNNY_STREAM_API_KEY || '').trim();
const getWebhookSecret = () =>
  String(process.env.BUNNY_STREAM_WEBHOOK_SECRET || process.env.BUNNY_STREAM_READ_ONLY_API_KEY || '').trim();

const getPullZoneHost = () =>
  String(process.env.BUNNY_STREAM_PULL_ZONE || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

const isBunnyStreamConfigured = () => Boolean(getLibraryId() && getApiKey() && getPullZoneHost());

const buildPlaybackUrls = (videoId) => {
  const host = getPullZoneHost();
  const id = String(videoId || '').trim();
  if (!host || !id) {
    return { hls_url: '', thumbnail_url: '' };
  }
  return {
    hls_url: `https://${host}/${id}/playlist.m3u8`,
    thumbnail_url: `https://${host}/${id}/thumbnail.jpg`,
  };
};

const bunnyClient = () => {
  if (!isBunnyStreamConfigured()) {
    throw new Error('Bunny Stream is not configured.');
  }
  return axios.create({
    baseURL: BUNNY_STREAM_API_BASE,
    headers: {
      AccessKey: getApiKey(),
      Accept: 'application/json',
    },
    timeout: 15000,
  });
};

const createBunnyVideo = async (title) => {
  const libraryId = getLibraryId();
  const response = await bunnyClient().post(`/library/${libraryId}/videos`, {
    title: String(title || `post_${Date.now()}`).slice(0, 200),
  });
  const guid = response.data?.guid;
  if (!guid) {
    throw new Error('Bunny Stream did not return a video id.');
  }
  return { guid: String(guid), raw: response.data };
};

const getBunnyVideo = async (videoId) => {
  const libraryId = getLibraryId();
  const id = String(videoId || '').trim();
  const response = await bunnyClient().get(`/library/${libraryId}/videos/${id}`);
  return response.data;
};

const deleteBunnyVideo = async (videoId) => {
  const id = String(videoId || '').trim();
  if (!id) return { ok: true, skipped: true };
  try {
    await bunnyClient().delete(`/library/${getLibraryId()}/videos/${id}`);
    return { ok: true, skipped: false };
  } catch (error) {
    const status = error.response?.status;
    if (status === 404) {
      return { ok: true, skipped: true };
    }
    console.error('Bunny Stream delete video failed', id, error.response?.data || error.message);
    return { ok: false, message: error.response?.data?.message || error.message };
  }
};

const createTusUploadTicket = (videoId, ttlSeconds) => {
  const libraryId = getLibraryId();
  const apiKey = getApiKey();
  const expirationTime = Math.floor(Date.now() / 1000) + Number(ttlSeconds);
  const signature = crypto
    .createHash('sha256')
    .update(`${libraryId}${apiKey}${expirationTime}${videoId}`)
    .digest('hex');

  return {
    bunny_video_id: String(videoId),
    library_id: libraryId,
    tus_endpoint: BUNNY_TUS_ENDPOINT,
    expiration_time: expirationTime,
    signature,
    max_duration_seconds: MAX_VIDEO_DURATION_SECONDS,
    tus_headers: {
      AuthorizationSignature: signature,
      AuthorizationExpire: String(expirationTime),
      VideoId: String(videoId),
      LibraryId: libraryId,
    },
  };
};

const resolveWebhookRawBody = (req) => {
  const event = req.apiGateway?.event;
  if (event?.body != null) {
    if (event.isBase64Encoded) {
      return Buffer.from(event.body, 'base64');
    }
    return typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
  }
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
};

const parseBunnyWebhookRequest = (req) => {
  const rawBody = resolveWebhookRawBody(req);
  const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  return {
    rawBody,
    body: bodyString ? JSON.parse(bodyString) : {},
  };
};

const verifyBunnyWebhookSignature = (rawBody, headers = {}) => {
  const secret = getWebhookSecret();
  if (!secret) {
    console.warn('Bunny Stream webhook secret is not configured.');
    return false;
  }

  const version = String(
    headers['x-bunnystream-signature-version'] || headers['X-BunnyStream-Signature-Version'] || ''
  ).trim();
  const algorithm = String(
    headers['x-bunnystream-signature-algorithm'] || headers['X-BunnyStream-Signature-Algorithm'] || ''
  )
    .trim()
    .toLowerCase();
  const signatureHeader = String(
    headers['x-bunnystream-signature'] || headers['X-BunnyStream-Signature'] || ''
  ).trim();

  if (version && version !== 'v1') return false;
  if (algorithm && algorithm !== 'hmac-sha256') return false;
  if (!signatureHeader || !/^[a-f0-9]+$/i.test(signatureHeader)) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expectedHex = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  if (signatureHeader.length !== expectedHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex, 'utf8'), Buffer.from(signatureHeader.toLowerCase(), 'utf8'));
};

const getBunnyVideoLengthSeconds = (bunnyVideo) => {
  const length = Number(bunnyVideo?.length);
  return Number.isFinite(length) ? length : 0;
};

const isBunnyVideoFinished = (bunnyVideo) => {
  const status = Number(bunnyVideo?.status);
  const progress = Number(bunnyVideo?.encodeProgress);
  const resolutions = String(bunnyVideo?.availableResolutions || '').trim();
  return (
    status === BUNNY_VIDEO_STATUS_FINISHED ||
    progress >= 100 ||
    (resolutions.length > 0 && getBunnyVideoLengthSeconds(bunnyVideo) > 0)
  );
};

const isBunnyVideoFailed = (bunnyVideo) => {
  const status = Number(bunnyVideo?.status);
  return status === BUNNY_VIDEO_STATUS_ERROR || status === BUNNY_VIDEO_STATUS_UPLOAD_FAILED;
};

module.exports = {
  BUNNY_TUS_ENDPOINT,
  BUNNY_WEBHOOK_STATUS_FINISHED,
  BUNNY_WEBHOOK_STATUS_RESOLUTION_FINISHED,
  BUNNY_WEBHOOK_STATUS_FAILED,
  BUNNY_WEBHOOK_STATUS_PRESIGNED_UPLOAD_FAILED,
  BUNNY_VIDEO_STATUS_FINISHED,
  isBunnyStreamConfigured,
  buildPlaybackUrls,
  createBunnyVideo,
  getBunnyVideo,
  deleteBunnyVideo,
  createTusUploadTicket,
  parseBunnyWebhookRequest,
  verifyBunnyWebhookSignature,
  getBunnyVideoLengthSeconds,
  isBunnyVideoFinished,
  isBunnyVideoFailed,
  MAX_VIDEO_DURATION_SECONDS,
};
