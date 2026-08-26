const mongoose = require('mongoose');
const { attachPartnerRatingFields } = require('../utils/rating_format');
const { v4: uuidv4 } = require('uuid');
const PartnerPost = require('../models/partner_post');
const PartnerPostLike = require('../models/partner_post_like');
const PartnerPostSave = require('../models/partner_post_save');
const User = require('../models/user');
const Order = require('../models/order');
const OrderService = require('../models/order_services');
const Category = require('../models/category');
const Service = require('../models/service');
const { fieldLabel } = require('../utils/field_labels');
const { USER_TYPE_PARTNER } = require('../constants/user_types');
const { POST_TYPE_ORDER, POST_TYPE_LEGACY_WORK } = require('../enum/post_type_enum');
const { POST_STATUS_PENDING, POST_STATUS_PUBLISHED } = require('../enum/post_report_reason_enum');
const { ORDER_STATUS_COMPLETED } = require('../enum/order_status_enum');
const { safeNotifyBackofficePartnerPostPending } = require('../src/modules/notifications/services/backofficeHooks');

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MIN_IMAGES = 1;
const MAX_IMAGES = 4;
const MAX_DESCRIPTION_LENGTH = 500;
const MIN_LEGACY_SERVICE_NAME_LENGTH = 3;

const OBJECT_ID_HEX_24 = /^[a-fA-F0-9]{24}$/;

const parsePositiveInt = (raw, fallback) => {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseObjectId = (raw, fieldName) => {
  const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
  if (!s || !OBJECT_ID_HEX_24.test(s)) {
    return { ok: false, message: `${fieldLabel(fieldName)} must be a valid id.` };
  }
  return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const generateShareToken = () => uuidv4().replace(/-/g, '');

const buildShareUrl = (shareToken) => {
  // HTTPS share links open in WhatsApp/SMS browsers, then deep-link into the app.
  // Override with POST_SHARE_WEB_BASE_URL if needed (default matches https://helppr.in/post/:token).
  const base = String(
    process.env.POST_SHARE_WEB_BASE_URL ||
      process.env.MOBILE_APP_SHARE_WEB_BASE ||
      'https://helppr.in/post'
  ).replace(/\/$/, '');
  return `${base}/${shareToken}`;
};

const assertPartnerCanPost = async (partnerId) => {
  if (!mongoose.Types.ObjectId.isValid(String(partnerId))) {
    return fail(401, 'Invalid token.');
  }

  const partnerOid = new mongoose.Types.ObjectId(String(partnerId));
  const partner = await User.findOne({
    _id: partnerOid,
    type: USER_TYPE_PARTNER,
    deleted_at: null,
  })
    .select('_id franchise_id verification_status is_active is_blocked')
    .lean();

  if (!partner) {
    return fail(404, 'Partner not found.');
  }

  if (Number(partner.verification_status) !== 2) {
    return fail(
      403,
      'Posts can only be created after your account is verified and approved.'
    );
  }

  if (!partner.is_active || partner.is_blocked) {
    return fail(403, 'Your partner account is not active.');
  }

  if (!partner.franchise_id) {
    return fail(400, 'Partner is not linked to a franchise.');
  }

  return ok(200, { partnerOid, partner });
};

const validateOrderLink = async (partnerId, orderId) => {
  const orderParsed = parseObjectId(orderId, 'order_id');
  if (!orderParsed.ok) {
    return fail(400, orderParsed.message);
  }

  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) {
    return partnerResult;
  }

  const { partnerOid, partner } = partnerResult.data;

  const order = await Order.findOne({
    _id: orderParsed.oid,
    deleted_at: null,
  })
    .select('_id partner_id franchise_id category_id service_id order_status unique_id')
    .lean();

  if (!order) {
    return fail(404, 'Order not found.');
  }

  if (String(order.partner_id) !== String(partnerOid)) {
    return fail(403, 'You can only link posts to your own orders.');
  }

  if (String(order.franchise_id) !== String(partner.franchise_id)) {
    return fail(400, 'Order does not belong to your franchise.');
  }

  if (order.order_status !== ORDER_STATUS_COMPLETED) {
    return fail(400, 'Only completed orders can be linked to a post.');
  }

  const existingPost = await PartnerPost.findOne({
    order_id: orderParsed.oid,
    deleted_at: null,
  })
    .select('_id')
    .lean();

  if (existingPost) {
    return fail(409, 'This order is already linked to another post.');
  }

  return ok(200, {
    orderOid: orderParsed.oid,
    category_id: order.category_id,
    service_id: order.service_id,
    order_unique_id: order.unique_id,
  });
};

/** Pre-check before order completion when publish_as_post=true (order may still be in-progress). */
const assertOrderPostLinkPreconditions = async (partnerId, orderId) => {
  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) return partnerResult;

  const orderParsed = parseObjectId(orderId, 'order_id');
  if (!orderParsed.ok) {
    return fail(400, orderParsed.message);
  }

  const { partnerOid, partner } = partnerResult.data;

  const order = await Order.findOne({
    _id: orderParsed.oid,
    deleted_at: null,
  })
    .select('_id partner_id franchise_id category_id service_id order_status')
    .lean();

  if (!order) {
    return fail(404, 'Order not found.');
  }

  if (String(order.partner_id) !== String(partnerOid)) {
    return fail(403, 'You can only link posts to your own orders.');
  }

  if (String(order.franchise_id) !== String(partner.franchise_id)) {
    return fail(400, 'Order does not belong to your franchise.');
  }

  const existingPost = await PartnerPost.findOne({
    order_id: orderParsed.oid,
    deleted_at: null,
  })
    .select('_id')
    .lean();

  if (existingPost) {
    return fail(409, 'This order is already linked to another post.');
  }

  return ok(200, {
    orderOid: orderParsed.oid,
    category_id: order.category_id,
    service_id: order.service_id,
  });
};

const parsePostDescription = (value) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return { ok: false, message: 'Description is required.' };
  }
  return { ok: true, text };
};

const parseRejectionReason = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) {
    return { ok: false, message: `${fieldLabel('rejection_reason')} is required when status is rejected.` };
  }
  return { ok: true, text };
};

/**
 * Create an order-linked partner post from pre-uploaded image URLs (e.g. order completion flow).
 * Order must already be completed and not linked to another post.
 */
const createOrderPostFromUrls = async (partnerId, orderId, imageUrls, description) => {
  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) return partnerResult;

  const orderLink = await validateOrderLink(partnerId, orderId);
  if (!orderLink.ok) return orderLink;

  const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
  if (urls.length < MIN_IMAGES || urls.length > MAX_IMAGES) {
    return fail(400, `Provide between ${MIN_IMAGES} and ${MAX_IMAGES} images.`);
  }

  const descParsed = parsePostDescription(description);
  if (!descParsed.ok) return fail(400, descParsed.message);

  const now = new Date();
  const post = await PartnerPost.create({
    partner_id: partnerResult.data.partnerOid,
    franchise_id: partnerResult.data.partner.franchise_id,
    post_type: POST_TYPE_ORDER,
    order_id: orderLink.data.orderOid,
    category_id: orderLink.data.category_id,
    service_id: orderLink.data.service_id,
    legacy_service_name: '',
    description: descParsed.text,
    image_urls: urls,
    status: POST_STATUS_PENDING,
    share_token: generateShareToken(),
    likes_count: 0,
    shares_count: 0,
    reports_count: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  await safeNotifyBackofficePartnerPostPending({
    post: post.toObject(),
    actorUserId: partnerId,
  });

  const mapped = await mapPostRecords([post.toObject()], { includePartner: true });
  return ok(201, { post: mapped[0], postId: post._id });
};

const loadLinkedLabels = async (posts) => {
  const categoryIds = new Set();
  const serviceIds = new Set();

  for (const post of posts) {
    if (post.category_id) categoryIds.add(String(post.category_id));
    if (post.service_id) serviceIds.add(String(post.service_id));
  }

  const [categories, services] = await Promise.all([
    categoryIds.size
      ? Category.find({ _id: { $in: [...categoryIds] }, deleted_at: null })
          .select('name')
          .lean()
      : [],
    serviceIds.size
      ? Service.find({ _id: { $in: [...serviceIds] }, deleted_at: null })
          .select('name')
          .lean()
      : [],
  ]);

  const categoryById = new Map(categories.map((c) => [String(c._id), c.name]));
  const serviceById = new Map(services.map((s) => [String(s._id), s.name]));

  return { categoryById, serviceById };
};

const loadLikedPostIds = async (userId, postIds) => {
  if (!userId || postIds.length === 0) {
    return new Set();
  }

  const likes = await PartnerPostLike.find({
    user_id: new mongoose.Types.ObjectId(String(userId)),
    post_id: { $in: postIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
  })
    .select('post_id')
    .lean();

  return new Set(likes.map((l) => String(l.post_id)));
};

const loadSavedPostIds = async (userId, postIds) => {
  if (!userId || postIds.length === 0) {
    return new Set();
  }

  const saves = await PartnerPostSave.find({
    user_id: new mongoose.Types.ObjectId(String(userId)),
    post_id: { $in: postIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
  })
    .select('post_id')
    .lean();

  return new Set(saves.map((s) => String(s.post_id)));
};

const loadSaveCountsByPostIds = async (postIds) => {
  if (!postIds.length) {
    return new Map();
  }

  const rows = await PartnerPostSave.aggregate([
    { $match: { post_id: { $in: postIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } },
    { $group: { _id: '$post_id', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), Math.max(0, Number(row.count) || 0)]));
};

const formatOrderServiceLocation = (order) => {
  const addr = order.address_id;
  if (addr && addr._id) {
    return {
      address: addr.address || order.address || '',
      landmark: addr.landmark || '',
      area_name: addr.area || null,
      city_name: addr.city || null,
      state_name: addr.state || null,
      pincode: addr.pincode || '',
    };
  }

  if (order.address) {
    return {
      address: order.address,
      landmark: '',
      area_name: null,
      city_name: null,
      state_name: null,
      pincode: '',
    };
  }

  return null;
};

const pickOrderServiceRating = (serviceLines, post) => {
  if (!serviceLines?.length) {
    return { rating: null, review_text: null, reviewed_at: null };
  }

  let line = null;
  if (post.service_id) {
    line = serviceLines.find(
      (row) =>
        String(row.service_id) === String(post.service_id) &&
        String(row.partner_id) === String(post.partner_id)
    );
  }

  if (!line && post.partner_id) {
    line = serviceLines.find((row) => String(row.partner_id) === String(post.partner_id));
  }

  if (!line) {
    line = serviceLines[0];
  }

  const rating = Number(line?.rating) || 0;
  if (rating <= 0) {
    return { rating: null, review_text: null, reviewed_at: null };
  }

  return {
    rating,
    review_text: line.review_text || '',
    reviewed_at: line.reviewed_at || null,
  };
};

const loadLinkedOrderDetails = async (posts) => {
  const orderIds = [
    ...new Set(
      posts
        .filter((post) => post.post_type === POST_TYPE_ORDER && post.order_id)
        .map((post) => String(post.order_id))
    ),
  ];

  if (orderIds.length === 0) {
    return new Map();
  }

  const orders = await Order.find({
    _id: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)) },
    deleted_at: null,
  })
    .select('_id address address_id service_items')
    .populate({
      path: 'address_id',
      select: 'address landmark pincode city state area city_id state_id area_id',
    })
    .lean();

  const serviceItemIds = [
    ...new Set(orders.flatMap((order) => (order.service_items || []).map((id) => String(id)))),
  ];

  const serviceLines = serviceItemIds.length
    ? await OrderService.find({
        _id: { $in: serviceItemIds.map((id) => new mongoose.Types.ObjectId(id)) },
        deleted_at: null,
      })
        .select('order_id service_id partner_id rating review_text reviewed_at')
        .lean()
    : [];

  const serviceLinesByOrderId = new Map();
  for (const line of serviceLines) {
    const key = String(line.order_id);
    if (!serviceLinesByOrderId.has(key)) {
      serviceLinesByOrderId.set(key, []);
    }
    serviceLinesByOrderId.get(key).push(line);
  }

  const orderById = new Map();
  for (const order of orders) {
    orderById.set(String(order._id), {
      service_location: formatOrderServiceLocation(order),
      serviceLines: serviceLinesByOrderId.get(String(order._id)) || [],
    });
  }

  return orderById;
};

const loadPartnerSummaries = async (partnerIds) => {
  if (partnerIds.length === 0) {
    return new Map();
  }

  const partners = await User.find({
    _id: { $in: partnerIds },
    deleted_at: null,
  })
    .select('_id name profile_url average_rating rating_count')
    .lean();

  return new Map(
    partners.map((p) => [
      String(p._id),
      {
        _id: p._id,
        name: p.name,
        profile_url: p.profile_url,
        ...attachPartnerRatingFields(p),
      },
    ])
  );
};

const buildLinkedBlock = (post, { categoryById, serviceById, orderDetail = null }) => {
  if (post.post_type === POST_TYPE_ORDER) {
    const ratingInfo = orderDetail
      ? pickOrderServiceRating(orderDetail.serviceLines, post)
      : { rating: null, review_text: null, reviewed_at: null };

    return {
      order_id: post.order_id,
      service_name: post.service_id ? serviceById.get(String(post.service_id)) || null : null,
      category_name: post.category_id ? categoryById.get(String(post.category_id)) || null : null,
      rating: ratingInfo.rating,
      review_text: ratingInfo.review_text,
      reviewed_at: ratingInfo.reviewed_at,
    };
  }

  if (post.post_type === POST_TYPE_LEGACY_WORK) {
    return {
      legacy_service_name: post.legacy_service_name || '',
      service_name: post.service_id ? serviceById.get(String(post.service_id)) || null : null,
      category_name: post.category_id ? categoryById.get(String(post.category_id)) || null : null,
    };
  }

  return null;
};

const mapPostRecord = (post, options = {}) => {
  const {
    userId = null,
    likedPostIds = new Set(),
    savedPostIds = new Set(),
    partnerById = new Map(),
    categoryById = new Map(),
    serviceById = new Map(),
    orderById = new Map(),
    saveCountByPostId = new Map(),
    includePartner = true,
    includeSaveCount = false,
  } = options;

  const orderDetail =
    post.post_type === POST_TYPE_ORDER && post.order_id
      ? orderById.get(String(post.order_id)) || null
      : null;

  const record = {
    _id: post._id,
    partner_id: post.partner_id,
    franchise_id: post.franchise_id,
    post_type: post.post_type,
    description: post.description,
    image_urls: post.image_urls || [],
    status: post.status,
    rejection_reason: post.rejection_reason || '',
    share_token: post.share_token,
    share_url: buildShareUrl(post.share_token),
    likes_count: post.likes_count ?? 0,
    shares_count: post.shares_count ?? 0,
    reports_count: post.reports_count ?? 0,
    created_at: post.created_at,
    updated_at: post.updated_at,
    linked: buildLinkedBlock(post, { categoryById, serviceById, orderDetail }),
  };

  if (includeSaveCount) {
    record.saves_count = saveCountByPostId.get(String(post._id)) ?? 0;
  }

  if (userId) {
    record.is_liked = likedPostIds.has(String(post._id));
    record.is_saved = savedPostIds.has(String(post._id));
  }

  if (includePartner && post.partner_id) {
    const partner = partnerById.get(String(post.partner_id));
    if (partner) {
      record.partner = {
        ...partner,
        ...(orderDetail?.service_location ? { service_location: orderDetail.service_location } : {}),
      };
    }
  }

  return record;
};

const mapPostRecords = async (posts, options = {}) => {
  const { userId = null, includePartner = true, includeSaveCount = false } = options;

  if (posts.length === 0) {
    return [];
  }

  const postIds = posts.map((p) => p._id);
  const partnerIds = [...new Set(posts.map((p) => String(p.partner_id)).filter(Boolean))];

  const [likedPostIds, savedPostIds, partnerById, labelMaps, orderById, saveCountByPostId] = await Promise.all([
    loadLikedPostIds(userId, postIds),
    loadSavedPostIds(userId, postIds),
    includePartner ? loadPartnerSummaries(partnerIds.map((id) => new mongoose.Types.ObjectId(id))) : Promise.resolve(new Map()),
    loadLinkedLabels(posts),
    loadLinkedOrderDetails(posts),
    includeSaveCount ? loadSaveCountsByPostIds(postIds) : Promise.resolve(new Map()),
  ]);

  return posts.map((post) =>
    mapPostRecord(post, {
      userId,
      likedPostIds,
      savedPostIds,
      partnerById,
      categoryById: labelMaps.categoryById,
      serviceById: labelMaps.serviceById,
      orderById,
      saveCountByPostId,
      includePartner,
      includeSaveCount,
    })
  );
};

const publishedPostFilter = (extra = {}) => ({
  status: POST_STATUS_PUBLISHED,
  deleted_at: null,
  ...extra,
});

const partnerPostScopeFilter = (partnerId) => {
  if (!partnerId || !mongoose.Types.ObjectId.isValid(String(partnerId))) {
    return null;
  }
  return {
    partner_id: new mongoose.Types.ObjectId(String(partnerId)),
    deleted_at: null,
  };
};

const emptyPartnerEngagementCounts = () => ({
  posts_count: 0,
  images_count: 0,
  video_count: 0,
  likes_count: 0,
  shares_count: 0,
  saves_count: 0,
});

const normalizePartnerObjectIds = (partnerIds = []) => {
  const oids = [];
  const seen = new Set();
  for (const raw of partnerIds) {
    const key = String(raw ?? '').trim();
    if (!key || !mongoose.Types.ObjectId.isValid(key) || seen.has(key)) continue;
    seen.add(key);
    oids.push(new mongoose.Types.ObjectId(key));
  }
  return oids;
};

/**
 * Batch engagement totals keyed by partner id string.
 * Uses denormalized likes_count / shares_count on each post so totals match
 * summing the values shown on post cards. images_count is the total number of
 * images on those same posts (1–4 per post). video_count is always 0 until
 * video posts are implemented.
 *
 * @param {Array<string|import('mongoose').Types.ObjectId>} partnerIds
 * @param {{ publishedOnly?: boolean }} [options]
 */
const getPartnersEngagementCountsByPartnerIds = async (
  partnerIds,
  { publishedOnly = false } = {}
) => {
  const oids = normalizePartnerObjectIds(partnerIds);
  const byPartnerId = new Map();
  if (oids.length === 0) {
    return byPartnerId;
  }

  const postMatch = {
    partner_id: { $in: oids },
    deleted_at: null,
  };
  if (publishedOnly) {
    postMatch.status = POST_STATUS_PUBLISHED;
  }

  const savePostMatch = {
    'post.partner_id': { $in: oids },
    'post.deleted_at': null,
  };
  if (publishedOnly) {
    savePostMatch['post.status'] = POST_STATUS_PUBLISHED;
  }

  const [postAgg, savesAgg] = await Promise.all([
    PartnerPost.aggregate([
      { $match: postMatch },
      {
        $group: {
          _id: '$partner_id',
          posts_count: { $sum: 1 },
          images_count: {
            $sum: {
              $cond: [
                { $isArray: '$image_urls' },
                { $size: '$image_urls' },
                0,
              ],
            },
          },
          likes_count: { $sum: { $ifNull: ['$likes_count', 0] } },
          shares_count: { $sum: { $ifNull: ['$shares_count', 0] } },
        },
      },
    ]),
    PartnerPostSave.aggregate([
      {
        $lookup: {
          from: PartnerPost.collection.name,
          localField: 'post_id',
          foreignField: '_id',
          as: 'post',
        },
      },
      { $unwind: '$post' },
      { $match: savePostMatch },
      { $group: { _id: '$post.partner_id', saves_count: { $sum: 1 } } },
    ]),
  ]);

  for (const oid of oids) {
    byPartnerId.set(String(oid), emptyPartnerEngagementCounts());
  }

  for (const row of postAgg) {
    const key = String(row._id);
    const current = byPartnerId.get(key) || emptyPartnerEngagementCounts();
    byPartnerId.set(key, {
      ...current,
      posts_count: Math.max(0, Number(row.posts_count) || 0),
      images_count: Math.max(0, Number(row.images_count) || 0),
      video_count: 0,
      likes_count: Math.max(0, Number(row.likes_count) || 0),
      shares_count: Math.max(0, Number(row.shares_count) || 0),
    });
  }

  for (const row of savesAgg) {
    const key = String(row._id);
    const current = byPartnerId.get(key) || emptyPartnerEngagementCounts();
    byPartnerId.set(key, {
      ...current,
      saves_count: Math.max(0, Number(row.saves_count) || 0),
    });
  }

  return byPartnerId;
};

/**
 * Aggregate post / image / like / share / save totals for a partner.
 * Uses the same denormalized counters shown on each post card so profile
 * totals match summing the partner's mobile post list.
 *
 * @param {string|import('mongoose').Types.ObjectId} partnerId
 * @param {{ publishedOnly?: boolean }} [options]
 *   - publishedOnly=false (default): all non-deleted posts (partner app list)
 *   - publishedOnly=true: published only (customer / admin partner gallery)
 */
const getPartnerEngagementCounts = async (partnerId, { publishedOnly = false } = {}) => {
  const postMatch = partnerPostScopeFilter(partnerId);
  if (!postMatch) {
    return emptyPartnerEngagementCounts();
  }

  const byPartnerId = await getPartnersEngagementCountsByPartnerIds([postMatch.partner_id], {
    publishedOnly,
  });
  return byPartnerId.get(String(postMatch.partner_id)) || emptyPartnerEngagementCounts();
};

const findPublishedPostById = async (postId) => {
  const parsed = parseObjectId(postId, 'post_id');
  if (!parsed.ok) {
    return fail(400, parsed.message);
  }

  const post = await PartnerPost.findOne(publishedPostFilter({ _id: parsed.oid })).lean();
  if (!post) {
    return fail(404, 'Post not found.');
  }

  return ok(200, { post, postOid: parsed.oid });
};

module.exports = {
  fail,
  ok,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MIN_IMAGES,
  MAX_IMAGES,
  MAX_DESCRIPTION_LENGTH,
  parseRejectionReason,
  MIN_LEGACY_SERVICE_NAME_LENGTH,
  parsePositiveInt,
  parseObjectId,
  generateShareToken,
  buildShareUrl,
  assertPartnerCanPost,
  validateOrderLink,
  assertOrderPostLinkPreconditions,
  createOrderPostFromUrls,
  mapPostRecord,
  mapPostRecords,
  publishedPostFilter,
  findPublishedPostById,
  getPartnerEngagementCounts,
  getPartnersEngagementCountsByPartnerIds,
  POST_TYPE_ORDER,
  POST_TYPE_LEGACY_WORK,
};
