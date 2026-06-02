const mongoose = require('mongoose');
const PartnerPost = require('../../../models/partner_post');
const PartnerPostLike = require('../../../models/partner_post_like');
const PartnerPostShare = require('../../../models/partner_post_share');
const PartnerPostReport = require('../../../models/partner_post_report');
const User = require('../../../models/user');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');
const { normalizeReportReason } = require('../../../enum/post_report_reason_enum');
const { REPORT_STATUS_PENDING } = require('../../../enum/post_report_reason_enum');
const {
  resolveFranchiseById,
  loadSubscribedFranchisePartners,
} = require('./franchise_partner_scope');
const {
  fail,
  ok,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePositiveInt,
  parseObjectId,
  buildShareUrl,
  mapPostRecords,
  publishedPostFilter,
  findPublishedPostById,
} = require('../../../services/partner_post_common_service');

const getVisiblePartnerIds = async (franchiseId) => {
  const franchiseResult = await resolveFranchiseById(franchiseId);
  if (!franchiseResult.ok) {
    return franchiseResult;
  }

  const { partnerIds } = await loadSubscribedFranchisePartners(franchiseResult.franchise._id);
  return ok(200, {
    franchise: franchiseResult.franchise,
    partnerIds: partnerIds.map((id) => new mongoose.Types.ObjectId(String(id))),
  });
};

const assertPartnerVisibleToCustomer = async (partnerId, franchiseId) => {
  const visible = await getVisiblePartnerIds(franchiseId);
  if (!visible.ok) return visible;

  const partnerParsed = parseObjectId(partnerId, 'partner_id');
  if (!partnerParsed.ok) return fail(400, partnerParsed.message);

  const allowed = visible.data.partnerIds.some(
    (id) => String(id) === String(partnerParsed.oid)
  );

  if (!allowed) {
    return fail(404, 'Partner not found.');
  }

  return ok(200, {
    franchise: visible.data.franchise,
    partnerOid: partnerParsed.oid,
  });
};

const listPostsFeed = async (userId, query) => {
  const visible = await getVisiblePartnerIds(query.franchise_id);
  if (!visible.ok) return visible;

  if (visible.data.partnerIds.length === 0) {
    return ok(200, {
      message: 'Feed retrieved successfully.',
      data: {
        franchise_id: visible.data.franchise._id,
        franchise_name: visible.data.franchise.name,
        records: [],
        totalItems: 0,
        totalPages: 0,
        currentPage: 1,
        limit: DEFAULT_LIMIT,
      },
    });
  }

  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(parsePositiveInt(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  const skip = (page - 1) * limit;

  const filter = publishedPostFilter({
    franchise_id: visible.data.franchise._id,
    partner_id: { $in: visible.data.partnerIds },
  });

  const [totalItems, posts] = await Promise.all([
    PartnerPost.countDocuments(filter),
    PartnerPost.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ]);

  const records = await mapPostRecords(posts, { userId, includePartner: true });
  const totalPages = Math.ceil(totalItems / limit) || 0;

  return ok(200, {
    message: 'Feed retrieved successfully.',
    data: {
      franchise_id: visible.data.franchise._id,
      franchise_name: visible.data.franchise.name,
      records,
      totalItems,
      totalPages,
      currentPage: page,
      limit,
    },
  });
};

const listPartnerProfilePosts = async (userId, partnerId, query) => {
  const partnerVisible = await assertPartnerVisibleToCustomer(partnerId, query.franchise_id);
  if (!partnerVisible.ok) return partnerVisible;

  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(parsePositiveInt(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  const skip = (page - 1) * limit;

  const filter = publishedPostFilter({
    partner_id: partnerVisible.data.partnerOid,
    franchise_id: partnerVisible.data.franchise._id,
  });

  const [totalItems, posts] = await Promise.all([
    PartnerPost.countDocuments(filter),
    PartnerPost.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ]);

  const records = await mapPostRecords(posts, { userId, includePartner: false });
  const totalPages = Math.ceil(totalItems / limit) || 0;

  return ok(200, {
    message: 'Partner posts retrieved successfully.',
    data: {
      partner_id: partnerVisible.data.partnerOid,
      records,
      totalItems,
      totalPages,
      currentPage: page,
      limit,
    },
  });
};

const getPostDetail = async (userId, postId, franchiseId) => {
  const postResult = await findPublishedPostById(postId);
  if (!postResult.ok) return postResult;

  const { post } = postResult.data;

  if (franchiseId) {
    const visible = await assertPartnerVisibleToCustomer(post.partner_id, franchiseId);
    if (!visible.ok) return visible;
  } else {
    const partner = await User.findOne({
      _id: post.partner_id,
      type: USER_TYPE_PARTNER,
      verification_status: 2,
      is_active: true,
      is_blocked: { $ne: true },
      deleted_at: null,
    })
      .select('_id')
      .lean();

    if (!partner) {
      return fail(404, 'Post not found.');
    }
  }

  const mapped = await mapPostRecords([post], { userId, includePartner: true });
  return ok(200, { message: 'Post retrieved successfully.', post: mapped[0] });
};

const resolvePostByShareToken = async (shareToken) => {
  const token = String(shareToken ?? '').trim();
  if (!token) {
    return fail(400, 'share token is required.');
  }

  const post = await PartnerPost.findOne(publishedPostFilter({ share_token: token })).lean();
  if (!post) {
    return fail(404, 'Post not found.');
  }

  const partner = await User.findOne({
    _id: post.partner_id,
    type: USER_TYPE_PARTNER,
    verification_status: 2,
    is_active: true,
    is_blocked: { $ne: true },
    deleted_at: null,
  })
    .select('_id name profile_url')
    .lean();

  if (!partner) {
    return fail(404, 'Post not found.');
  }

  const mapped = await mapPostRecords([post], { includePartner: true });
  return ok(200, {
    message: 'Post retrieved successfully.',
    post: mapped[0],
    share_url: buildShareUrl(token),
  });
};

const togglePostLike = async (userId, postId) => {
  const postResult = await findPublishedPostById(postId);
  if (!postResult.ok) return postResult;

  const { post, postOid } = postResult.data;
  const userOid = new mongoose.Types.ObjectId(String(userId));

  const existing = await PartnerPostLike.findOne({
    post_id: postOid,
    user_id: userOid,
  });

  let isLiked = false;

  if (existing) {
    await PartnerPostLike.deleteOne({ _id: existing._id });
    if ((post.likes_count ?? 0) > 0) {
      await PartnerPost.updateOne({ _id: postOid }, { $inc: { likes_count: -1 } });
    }
    isLiked = false;
  } else {
    await PartnerPostLike.create({
      post_id: postOid,
      user_id: userOid,
      created_at: new Date(),
    });
    await PartnerPost.updateOne({ _id: postOid }, { $inc: { likes_count: 1 } });
    isLiked = true;
  }

  const updated = await PartnerPost.findById(postOid).select('likes_count').lean();

  return ok(200, {
    message: isLiked ? 'Post liked.' : 'Post unliked.',
    data: {
      post_id: postOid,
      is_liked: isLiked,
      likes_count: Math.max(0, updated?.likes_count ?? post.likes_count),
    },
  });
};

const recordPostShare = async (userId, postId) => {
  const postResult = await findPublishedPostById(postId);
  if (!postResult.ok) return postResult;

  const { post, postOid } = postResult.data;
  const userOid = userId ? new mongoose.Types.ObjectId(String(userId)) : null;

  await PartnerPostShare.create({
    post_id: postOid,
    user_id: userOid,
    created_at: new Date(),
  });

  await PartnerPost.updateOne({ _id: postOid }, { $inc: { shares_count: 1 } });
  const updated = await PartnerPost.findById(postOid).select('shares_count share_token').lean();

  return ok(200, {
    message: 'Share recorded successfully.',
    data: {
      post_id: postOid,
      share_token: updated.share_token,
      share_url: buildShareUrl(updated.share_token),
      shares_count: updated.shares_count ?? post.shares_count + 1,
    },
  });
};

const reportPost = async (userId, postId, body) => {
  const postResult = await findPublishedPostById(postId);
  if (!postResult.ok) return postResult;

  const reason = normalizeReportReason(body.reason);
  if (!reason) {
    return fail(400, 'reason must be one of: spam, inappropriate, misleading, other.');
  }

  const details = body.details != null ? String(body.details).trim() : '';
  if (details.length > 1000) {
    return fail(400, 'details must be at most 1000 characters.');
  }

  const { postOid } = postResult.data;
  const userOid = new mongoose.Types.ObjectId(String(userId));

  const existing = await PartnerPostReport.findOne({
    post_id: postOid,
    user_id: userOid,
  }).lean();

  if (existing) {
    return fail(409, 'You have already reported this post.');
  }

  const now = new Date();
  await PartnerPostReport.create({
    post_id: postOid,
    user_id: userOid,
    reason,
    details,
    status: REPORT_STATUS_PENDING,
    created_at: now,
    updated_at: now,
  });

  await PartnerPost.updateOne({ _id: postOid }, { $inc: { reports_count: 1 } });

  return ok(200, { message: 'Post reported successfully.' });
};

module.exports = {
  listPostsFeed,
  listPartnerProfilePosts,
  getPostDetail,
  resolvePostByShareToken,
  togglePostLike,
  recordPostShare,
  reportPost,
};
