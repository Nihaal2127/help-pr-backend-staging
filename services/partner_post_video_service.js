const PartnerPost = require('../models/partner_post');
const PartnerPostVideoSession = require('../models/partner_post_video_session');
const {
  POST_MEDIA_TYPE_IMAGE,
  POST_MEDIA_TYPE_VIDEO,
  VIDEO_STATUS_PROCESSING,
  VIDEO_STATUS_READY,
  VIDEO_STATUS_FAILED,
  MAX_VIDEO_DURATION_SECONDS,
  VIDEO_UPLOAD_SESSION_TTL_SECONDS,
  parseBunnyVideoId,
} = require('../enum/post_media_enum');
const {
  isBunnyStreamConfigured,
  createBunnyVideo,
  getBunnyVideo,
  deleteBunnyVideo,
  createTusUploadTicket,
  buildPlaybackUrls,
  getBunnyVideoLengthSeconds,
  isBunnyVideoFinished,
  isBunnyVideoFailed,
  isBunnyVideoReusableForTus,
  isPlayableWebhookStatus,
  BUNNY_WEBHOOK_STATUS_FINISHED,
  BUNNY_WEBHOOK_STATUS_RESOLUTION_FINISHED,
  BUNNY_WEBHOOK_STATUS_FAILED,
  BUNNY_WEBHOOK_STATUS_PRESIGNED_UPLOAD_FAILED,
} = require('./bunny_stream_service');
const { fail, ok, assertPartnerCanPost, validateOrderLink, generateShareToken, mapPostRecords } = require('./partner_post_common_service');
const { POST_STATUS_PENDING } = require('../enum/post_report_reason_enum');
const { POST_TYPE_ORDER } = require('../enum/post_type_enum');
const { safeNotifyBackofficePartnerPostPending } = require('../src/modules/notifications/services/backofficeHooks');

const TOO_LONG_MESSAGE = `Video must be ${MAX_VIDEO_DURATION_SECONDS} seconds or shorter.`;

const buildProcessingVideo = (bunnyVideoId) => ({
  bunny_video_id: String(bunnyVideoId),
  hls_url: '',
  thumbnail_url: '',
  duration_seconds: null,
  status: VIDEO_STATUS_PROCESSING,
  failure_reason: '',
});

const applyReadyPlayback = (videoId, durationSeconds) => {
  const playback = buildPlaybackUrls(videoId);
  return {
    bunny_video_id: String(videoId),
    hls_url: playback.hls_url,
    thumbnail_url: playback.thumbnail_url,
    duration_seconds: durationSeconds,
    status: VIDEO_STATUS_READY,
    failure_reason: '',
  };
};

const applyFailedVideo = (videoId, reason) => ({
  bunny_video_id: String(videoId || ''),
  hls_url: '',
  thumbnail_url: '',
  duration_seconds: null,
  status: VIDEO_STATUS_FAILED,
  failure_reason: reason || 'Video processing failed.',
});

const pickVideoAfterResolve = (resolved, session, videoId) => {
  if (
    resolved.video.status === VIDEO_STATUS_PROCESSING &&
    isPlayableWebhookStatus(session?.last_webhook_status)
  ) {
    return applyReadyPlayback(videoId, resolved.video.duration_seconds);
  }
  return resolved.video;
};

const refreshSessionTicket = async (session) => {
  const ticket = createTusUploadTicket(session.bunny_video_id, VIDEO_UPLOAD_SESSION_TTL_SECONDS);
  session.expires_at = new Date(ticket.expiration_time * 1000);
  await session.save();
  return ticket;
};

const createVideoUploadSession = async (partnerId) => {
  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) return partnerResult;

  if (!isBunnyStreamConfigured()) {
    return fail(503, 'Video uploads are not configured.');
  }

  const partnerOid = partnerResult.data.partnerOid;
  const existing = await PartnerPostVideoSession.findOne({
    partner_id: partnerOid,
    consumed_post_id: null,
  }).sort({ created_at: -1 });

  if (existing) {
    try {
      const bunnyVideo = await getBunnyVideo(existing.bunny_video_id);
      if (isBunnyVideoFailed(bunnyVideo)) {
        await deleteBunnyVideo(existing.bunny_video_id);
        await PartnerPostVideoSession.deleteOne({ _id: existing._id });
      } else if (isBunnyVideoReusableForTus(bunnyVideo)) {
        const ticket = await refreshSessionTicket(existing);
        return ok(200, {
          message: 'Video upload session created.',
          session: ticket,
        });
      }
    } catch (error) {
      console.error('reuseVideoUploadSession', existing.bunny_video_id, error.response?.data || error.message);
    }
  }

  let createdGuid = null;
  try {
    const created = await createBunnyVideo(`partner_${partnerId}_${Date.now()}`);
    createdGuid = created.guid;
    const ticket = createTusUploadTicket(createdGuid, VIDEO_UPLOAD_SESSION_TTL_SECONDS);
    const expiresAt = new Date(ticket.expiration_time * 1000);

    await PartnerPostVideoSession.create({
      partner_id: partnerOid,
      bunny_video_id: createdGuid,
      expires_at: expiresAt,
      consumed_post_id: null,
      consumed_at: null,
      created_at: new Date(),
    });

    return ok(200, {
      message: 'Video upload session created.',
      session: ticket,
    });
  } catch (error) {
    if (createdGuid) {
      await deleteBunnyVideo(createdGuid);
    }
    console.error('createVideoUploadSession', error.response?.data || error.message);
    return fail(502, 'Could not create video upload session.');
  }
};

const consumeVideoSession = async (partnerId, bunnyVideoId, postId) => {
  const videoId = parseBunnyVideoId(bunnyVideoId);
  if (!videoId) {
    return fail(400, 'Video is required.');
  }

  const session = await PartnerPostVideoSession.findOneAndUpdate(
    {
      partner_id: partnerId,
      bunny_video_id: videoId,
      $or: [{ consumed_post_id: null }, { consumed_post_id: postId }],
    },
    { $set: { consumed_post_id: postId, consumed_at: new Date() } },
    { new: true }
  );

  if (!session) {
    return fail(400, 'Video upload session is invalid or expired.');
  }

  return ok(200, { session });
};

const resolveVideoFieldsFromBunny = async (bunnyVideoId) => {
  const videoId = parseBunnyVideoId(bunnyVideoId);
  if (!videoId) {
    return { video: buildProcessingVideo(''), overDuration: false };
  }

  try {
    const bunnyVideo = await getBunnyVideo(videoId);
    if (isBunnyVideoFailed(bunnyVideo)) {
      return { video: applyFailedVideo(videoId, 'Video processing failed.'), overDuration: false };
    }

    if (isBunnyVideoFinished(bunnyVideo)) {
      const length = getBunnyVideoLengthSeconds(bunnyVideo);
      if (length > MAX_VIDEO_DURATION_SECONDS) {
        await deleteBunnyVideo(videoId);
        return {
          video: applyFailedVideo(videoId, TOO_LONG_MESSAGE),
          overDuration: true,
        };
      }
      return { video: applyReadyPlayback(videoId, length || null), overDuration: false };
    }

    return { video: buildProcessingVideo(videoId), overDuration: false };
  } catch (error) {
    console.error('resolveVideoFieldsFromBunny', videoId, error.response?.data || error.message);
    return { video: buildProcessingVideo(videoId), overDuration: false };
  }
};

const attachVideoToNewPost = async (partnerId, bunnyVideoId, post) => {
  const consumed = await consumeVideoSession(partnerId, bunnyVideoId, post._id);
  if (!consumed.ok) {
    await PartnerPost.deleteOne({ _id: post._id });
    return consumed;
  }

  const resolved = await resolveVideoFieldsFromBunny(bunnyVideoId);
  if (resolved.overDuration) {
    await PartnerPost.deleteOne({ _id: post._id });
    return fail(400, TOO_LONG_MESSAGE);
  }

  post.video = pickVideoAfterResolve(
    resolved,
    consumed.data.session,
    parseBunnyVideoId(bunnyVideoId)
  );
  post.media_type = POST_MEDIA_TYPE_VIDEO;
  post.image_urls = [];
  post.updated_at = new Date();
  await post.save();
  return ok(200, { post });
};

const replacePostVideo = async (partnerId, post, bunnyVideoId) => {
  const previousVideoId = post.video?.bunny_video_id;
  const resolved = await resolveVideoFieldsFromBunny(bunnyVideoId);
  if (resolved.overDuration) {
    return fail(400, TOO_LONG_MESSAGE);
  }

  const consumed = await consumeVideoSession(partnerId, bunnyVideoId, post._id);
  if (!consumed.ok) {
    return consumed;
  }

  post.media_type = POST_MEDIA_TYPE_VIDEO;
  post.image_urls = [];
  post.video = pickVideoAfterResolve(
    resolved,
    consumed.data.session,
    parseBunnyVideoId(bunnyVideoId)
  );
  post.updated_at = new Date();
  await post.save();

  if (previousVideoId && previousVideoId !== parseBunnyVideoId(bunnyVideoId)) {
    await deleteBunnyVideo(previousVideoId);
  }

  return ok(200, { post });
};

const clearPostVideo = async (post) => {
  const videoId = post.video?.bunny_video_id;
  post.set('video', undefined);
  post.media_type = POST_MEDIA_TYPE_IMAGE;
  if (videoId) {
    await deleteBunnyVideo(videoId);
  }
};

const deleteStoredPostVideo = async (post) => {
  const videoId = post?.video?.bunny_video_id;
  if (!videoId) return;
  await deleteBunnyVideo(videoId);
};

const postNeedsVideoSync = (post) =>
  post?.media_type === POST_MEDIA_TYPE_VIDEO &&
  post.video?.status === VIDEO_STATUS_PROCESSING &&
  Boolean(parseBunnyVideoId(post.video?.bunny_video_id));

const syncPostVideoFromBunny = async (post) => {
  if (!postNeedsVideoSync(post)) return post;

  const videoId = post.video.bunny_video_id;
  const [resolved, session] = await Promise.all([
    resolveVideoFieldsFromBunny(videoId),
    PartnerPostVideoSession.findOne({ bunny_video_id: videoId }).lean(),
  ]);
  const next = resolved.overDuration
    ? applyFailedVideo(videoId, TOO_LONG_MESSAGE)
    : pickVideoAfterResolve(resolved, session, videoId);

  if (next.status === post.video.status && (next.hls_url || '') === (post.video.hls_url || '')) {
    return post;
  }

  await PartnerPost.updateOne(
    { _id: post._id },
    { $set: { video: next, updated_at: new Date() } }
  );
  post.video = next;
  return post;
};

const syncPostsVideosFromBunny = async (posts = []) => {
  const targets = posts.filter(postNeedsVideoSync);
  if (targets.length === 0) return posts;
  await Promise.all(targets.map((post) => syncPostVideoFromBunny(post)));
  return posts;
};

const parseWebhookVideoId = (payload) =>
  parseBunnyVideoId(payload?.VideoGuid || payload?.videoGuid || payload?.guid);

const parseWebhookStatus = (payload) => {
  const raw = payload?.Status ?? payload?.status;
  const status = Number(raw);
  return Number.isFinite(status) ? status : null;
};

const applyWebhookStatusToPost = async (payload) => {
  const videoId = parseWebhookVideoId(payload);
  if (!videoId) {
    return { ok: true, ignored: true };
  }

  const status = parseWebhookStatus(payload);
  if (status == null) {
    return { ok: true, ignored: true };
  }

  await PartnerPostVideoSession.updateOne(
    { bunny_video_id: videoId },
    { $set: { last_webhook_status: status, last_webhook_at: new Date() } }
  );

  const post = await PartnerPost.findOne({
    'video.bunny_video_id': videoId,
    deleted_at: null,
  });

  if (!post) {
    return { ok: true, ignored: true };
  }

  if (status === BUNNY_WEBHOOK_STATUS_FAILED || status === BUNNY_WEBHOOK_STATUS_PRESIGNED_UPLOAD_FAILED) {
    post.video = applyFailedVideo(videoId, 'Video processing failed.');
    post.updated_at = new Date();
    await post.save();
    return { ok: true, ignored: false };
  }

  if (status !== BUNNY_WEBHOOK_STATUS_FINISHED && status !== BUNNY_WEBHOOK_STATUS_RESOLUTION_FINISHED) {
    return { ok: true, ignored: true };
  }

  const resolved = await resolveVideoFieldsFromBunny(videoId);
  if (resolved.overDuration) {
    post.video = applyFailedVideo(videoId, TOO_LONG_MESSAGE);
    post.updated_at = new Date();
    await post.save();
    return { ok: true, ignored: false };
  }

  post.video =
    resolved.video.status === VIDEO_STATUS_READY
      ? resolved.video
      : applyReadyPlayback(videoId, resolved.video.duration_seconds);
  post.updated_at = new Date();
  await post.save();
  return { ok: true, ignored: false };
};

const createOrderPostFromVideo = async (partnerId, orderId, bunnyVideoId, description) => {
  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) return partnerResult;

  const videoId = parseBunnyVideoId(bunnyVideoId);
  if (!videoId) {
    return fail(400, 'Video is required.');
  }

  const orderLink = await validateOrderLink(partnerId, orderId);
  if (!orderLink.ok) return orderLink;

  const text = String(description ?? '').trim();
  if (!text) {
    return fail(400, 'Description is required.');
  }

  const now = new Date();
  const post = await PartnerPost.create({
    partner_id: partnerResult.data.partnerOid,
    franchise_id: partnerResult.data.partner.franchise_id,
    post_type: POST_TYPE_ORDER,
    order_id: orderLink.data.orderOid,
    category_id: orderLink.data.category_id,
    service_id: orderLink.data.service_id,
    legacy_service_name: '',
    description: text,
    media_type: POST_MEDIA_TYPE_VIDEO,
    image_urls: [],
    status: POST_STATUS_PENDING,
    share_token: generateShareToken(),
    likes_count: 0,
    shares_count: 0,
    reports_count: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  const attached = await attachVideoToNewPost(partnerResult.data.partnerOid, videoId, post);
  if (!attached.ok) return attached;

  await safeNotifyBackofficePartnerPostPending({
    post: post.toObject(),
    actorUserId: partnerId,
  });

  const mapped = await mapPostRecords([post.toObject()], { includePartner: true });
  return ok(201, { post: mapped[0], postId: post._id });
};

module.exports = {
  buildProcessingVideo,
  createVideoUploadSession,
  consumeVideoSession,
  attachVideoToNewPost,
  replacePostVideo,
  clearPostVideo,
  deleteStoredPostVideo,
  applyWebhookStatusToPost,
  syncPostsVideosFromBunny,
  createOrderPostFromVideo,
  TOO_LONG_MESSAGE,
};
