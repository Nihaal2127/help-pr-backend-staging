const mongoose = require('mongoose');
const PartnerPost = require('../../../models/partner_post');
const Order = require('../../../models/order');
const Category = require('../../../models/category');
const Service = require('../../../models/service');
const { handleImageUpload } = require('../../../helper/image_uploader');
const { getUploadType } = require('../../../enum/upload_type_enum');
const { normalizePostType } = require('../../../enum/post_type_enum');
const { POST_STATUS_PUBLISHED } = require('../../../enum/post_report_reason_enum');
const { ORDER_STATUS_COMPLETED } = require('../../../enum/order_status_enum');
const {
  fail,
  ok,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MIN_IMAGES,
  MAX_IMAGES,
  MAX_DESCRIPTION_LENGTH,
  MIN_LEGACY_SERVICE_NAME_LENGTH,
  parsePositiveInt,
  parseObjectId,
  generateShareToken,
  assertPartnerCanPost,
  validateOrderLink,
  mapPostRecords,
  POST_TYPE_ORDER,
  POST_TYPE_LEGACY_WORK,
} = require('../../../services/partner_post_common_service');

const uploadPostImages = async (files) => {
  const uploadType = getUploadType(5);
  const urls = [];

  for (const file of files) {
    const url = await handleImageUpload(file, uploadType, true, null);
    urls.push(url);
  }

  return urls;
};

const parseDescription = (value) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return { ok: false, message: 'Description is required.' };
  }
  if (text.length > MAX_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      message: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    };
  }
  return { ok: true, text };
};

const validateLegacyServiceRefs = async (categoryId, serviceId, franchiseId) => {
  let categoryOid = null;
  let serviceOid = null;

  if (categoryId) {
    const parsed = parseObjectId(categoryId, 'category_id');
    if (!parsed.ok) return fail(400, parsed.message);
    categoryOid = parsed.oid;

    const category = await Category.findOne({ _id: categoryOid, deleted_at: null }).lean();
    if (!category || !category.is_active || category.approval_status !== 'approve') {
      return fail(400, 'Category not found or not available.');
    }
  }

  if (serviceId) {
    const parsed = parseObjectId(serviceId, 'service_id');
    if (!parsed.ok) return fail(400, parsed.message);
    serviceOid = parsed.oid;

    const service = await Service.findOne({ _id: serviceOid, deleted_at: null }).lean();
    if (!service || !service.is_active || service.approval_status !== 'approve') {
      return fail(400, 'Service not found or not available.');
    }

    if (categoryOid && String(service.category_id) !== String(categoryOid)) {
      return fail(400, 'Service does not belong to the selected category.');
    }

    if (!categoryOid) {
      categoryOid = service.category_id;
    }
  }

  return ok(200, { categoryOid, serviceOid });
};

const createPartnerPost = async (partnerId, body, files) => {
  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) return partnerResult;

  const { partnerOid, partner } = partnerResult.data;

  const postType = normalizePostType(body.post_type);
  if (!postType) {
    return fail(400, `post_type must be one of: order, legacy_work.`);
  }

  const descParsed = parseDescription(body.description);
  if (!descParsed.ok) return fail(400, descParsed.message);

  const imageFiles = Array.isArray(files) ? files : [];
  if (imageFiles.length < MIN_IMAGES || imageFiles.length > MAX_IMAGES) {
    return fail(400, `Provide between ${MIN_IMAGES} and ${MAX_IMAGES} images.`);
  }

  let orderOid = null;
  let categoryOid = null;
  let serviceOid = null;
  let legacyServiceName = '';

  if (postType === POST_TYPE_ORDER) {
    if (!body.order_id) {
      return fail(400, 'order_id is required for order posts.');
    }

    const orderLink = await validateOrderLink(partnerId, body.order_id);
    if (!orderLink.ok) return orderLink;

    orderOid = orderLink.data.orderOid;
    categoryOid = orderLink.data.category_id;
    serviceOid = orderLink.data.service_id;
  } else {
    legacyServiceName = String(body.legacy_service_name ?? '').trim();
    if (legacyServiceName.length < MIN_LEGACY_SERVICE_NAME_LENGTH) {
      return fail(
        400,
        `legacy_service_name is required and must be at least ${MIN_LEGACY_SERVICE_NAME_LENGTH} characters.`
      );
    }

    const refs = await validateLegacyServiceRefs(
      body.category_id,
      body.service_id,
      partner.franchise_id
    );
    if (!refs.ok) return refs;
    categoryOid = refs.data.categoryOid;
    serviceOid = refs.data.serviceOid;
  }

  const imageUrls = await uploadPostImages(imageFiles);
  const now = new Date();

  const post = await PartnerPost.create({
    partner_id: partnerOid,
    franchise_id: partner.franchise_id,
    post_type: postType,
    order_id: orderOid,
    category_id: categoryOid,
    service_id: serviceOid,
    legacy_service_name: legacyServiceName,
    description: descParsed.text,
    image_urls: imageUrls,
    status: POST_STATUS_PUBLISHED,
    share_token: generateShareToken(),
    likes_count: 0,
    shares_count: 0,
    reports_count: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  const mapped = await mapPostRecords([post.toObject()], { includePartner: true });
  return ok(201, { message: 'Post created successfully.', post: mapped[0] });
};

const listPartnerPosts = async (partnerId, query) => {
  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) return partnerResult;

  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(parsePositiveInt(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  const skip = (page - 1) * limit;

  const filter = {
    partner_id: partnerResult.data.partnerOid,
    deleted_at: null,
  };

  const [totalItems, posts] = await Promise.all([
    PartnerPost.countDocuments(filter),
    PartnerPost.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ]);

  const records = await mapPostRecords(posts, { includePartner: true });
  const totalPages = Math.ceil(totalItems / limit) || 0;

  return ok(200, {
    message: 'Posts retrieved successfully.',
    data: {
      records,
      totalItems,
      totalPages,
      currentPage: page,
      limit,
    },
  });
};

const listOrderOptions = async (partnerId, query) => {
  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) return partnerResult;

  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(parsePositiveInt(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  const skip = (page - 1) * limit;

  const filter = {
    partner_id: partnerResult.data.partnerOid,
    franchise_id: partnerResult.data.partner.franchise_id,
    order_status: ORDER_STATUS_COMPLETED,
    deleted_at: null,
  };

  const [totalItems, orders] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter)
      .select('_id unique_id category_id service_id created_at updated_at')
      .sort({ updated_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const orderIds = orders.map((o) => o._id);
  const linkedPosts = orderIds.length
    ? await PartnerPost.find({
        order_id: { $in: orderIds },
        deleted_at: null,
      })
        .select('order_id')
        .lean()
    : [];

  const linkedOrderIds = new Set(linkedPosts.map((p) => String(p.order_id)));

  const serviceIds = [...new Set(orders.map((o) => String(o.service_id)).filter(Boolean))];
  const services = serviceIds.length
    ? await Service.find({ _id: { $in: serviceIds }, deleted_at: null }).select('name').lean()
    : [];
  const serviceById = new Map(services.map((s) => [String(s._id), s.name]));

  const records = orders.map((order) => ({
    _id: order._id,
    unique_id: order.unique_id,
    service_id: order.service_id,
    service_name: order.service_id ? serviceById.get(String(order.service_id)) || null : null,
    category_id: order.category_id,
    already_linked: linkedOrderIds.has(String(order._id)),
  }));

  const totalPages = Math.ceil(totalItems / limit) || 0;

  return ok(200, {
    message: 'Order options retrieved successfully.',
    data: {
      records,
      totalItems,
      totalPages,
      currentPage: page,
      limit,
    },
  });
};

const getPartnerPostById = async (partnerId, postId) => {
  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) return partnerResult;

  const parsed = parseObjectId(postId, 'post_id');
  if (!parsed.ok) return fail(400, parsed.message);

  const post = await PartnerPost.findOne({
    _id: parsed.oid,
    partner_id: partnerResult.data.partnerOid,
    deleted_at: null,
  }).lean();

  if (!post) {
    return fail(404, 'Post not found.');
  }

  const mapped = await mapPostRecords([post], { includePartner: true });
  return ok(200, { message: 'Post retrieved successfully.', post: mapped[0] });
};

const updatePartnerPost = async (partnerId, postId, body, files) => {
  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) return partnerResult;

  const parsed = parseObjectId(postId, 'post_id');
  if (!parsed.ok) return fail(400, parsed.message);

  const post = await PartnerPost.findOne({
    _id: parsed.oid,
    partner_id: partnerResult.data.partnerOid,
    deleted_at: null,
  });

  if (!post) {
    return fail(404, 'Post not found.');
  }

  const updates = { updated_at: new Date() };

  if (body.description !== undefined) {
    const descParsed = parseDescription(body.description);
    if (!descParsed.ok) return fail(400, descParsed.message);
    updates.description = descParsed.text;
  }

  const imageFiles = Array.isArray(files) ? files : [];
  const keepExistingRaw = body.keep_existing_images;
  let keepExisting = [];

  if (keepExistingRaw !== undefined && keepExistingRaw !== null && String(keepExistingRaw).trim() !== '') {
    try {
      const parsedKeep =
        typeof keepExistingRaw === 'string' ? JSON.parse(keepExistingRaw) : keepExistingRaw;
      if (!Array.isArray(parsedKeep)) {
        return fail(400, 'keep_existing_images must be a JSON array of image URLs to retain.');
      }
      keepExisting = parsedKeep.map((u) => String(u).trim()).filter(Boolean);
    } catch {
      return fail(400, 'keep_existing_images must be valid JSON.');
    }
  } else if (imageFiles.length > 0) {
    keepExisting = [];
  } else {
    keepExisting = [...(post.image_urls || [])];
  }

  const finalImages = [...keepExisting];
  if (imageFiles.length > 0) {
    const uploaded = await uploadPostImages(imageFiles);
    finalImages.push(...uploaded);
  }

  if (finalImages.length < MIN_IMAGES || finalImages.length > MAX_IMAGES) {
    return fail(400, `Post must have between ${MIN_IMAGES} and ${MAX_IMAGES} images.`);
  }

  updates.image_urls = finalImages;

  Object.assign(post, updates);
  await post.save();

  const mapped = await mapPostRecords([post.toObject()], { includePartner: true });
  return ok(200, { message: 'Post updated successfully.', post: mapped[0] });
};

const deletePartnerPost = async (partnerId, postId) => {
  const partnerResult = await assertPartnerCanPost(partnerId);
  if (!partnerResult.ok) return partnerResult;

  const parsed = parseObjectId(postId, 'post_id');
  if (!parsed.ok) return fail(400, parsed.message);

  const post = await PartnerPost.findOne({
    _id: parsed.oid,
    partner_id: partnerResult.data.partnerOid,
    deleted_at: null,
  });

  if (!post) {
    return fail(404, 'Post not found.');
  }

  post.deleted_at = new Date();
  post.updated_at = new Date();
  await post.save();

  return ok(200, { message: 'Post deleted successfully.' });
};

module.exports = {
  createPartnerPost,
  listPartnerPosts,
  listOrderOptions,
  getPartnerPostById,
  updatePartnerPost,
  deletePartnerPost,
};
