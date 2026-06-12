const mongoose = require('mongoose');
const PartnerPost = require('../models/partner_post');
const PartnerPostReport = require('../models/partner_post_report');
const User = require('../models/user');
const {
  normalizePostStatus,
  normalizeReportStatus,
  REPORT_STATUS_PENDING,
  POST_STATUS_PUBLISHED,
  POST_STATUS_HIDDEN,
  POST_STATUS_REMOVED,
} = require('../enum/post_report_reason_enum');
const { resolvePartnerPostListScope } = require('../utils/partner_post_access');
const {
  fail,
  ok,
  parsePositiveInt,
  parseObjectId,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  mapPostRecords,
} = require('./partner_post_common_service');

const MAX_ADMIN_LIMIT = 100;

const buildPostListScopeFilter = async (req, query = {}) => {
  const scopeResult = await resolvePartnerPostListScope(req, {
    franchiseIdFromQuery: query.franchise_id,
  });
  if (!scopeResult.ok) {
    return { ok: false, status: scopeResult.status, message: scopeResult.message };
  }

  const filter = { deleted_at: null, ...scopeResult.filter };

  if (query.partner_id) {
    const parsed = parseObjectId(query.partner_id, 'partner_id');
    if (!parsed.ok) {
      return { ok: false, status: 400, message: parsed.message };
    }
    filter.partner_id = parsed.oid;
  }

  return { ok: true, filter };
};

const countReportStatusesForPostFilter = async (postFilter) => {
  const postMatch = Object.fromEntries(
    Object.entries(postFilter).map(([key, value]) => [`post.${key}`, value])
  );

  const rows = await PartnerPostReport.aggregate([
    {
      $lookup: {
        from: PartnerPost.collection.name,
        localField: 'post_id',
        foreignField: '_id',
        as: 'post',
      },
    },
    { $unwind: '$post' },
    { $match: postMatch },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const byStatus = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  return {
    pending: byStatus.pending ?? 0,
    reviewed: byStatus.reviewed ?? 0,
    dismissed: byStatus.dismissed ?? 0,
  };
};

const getPostCounts = async (req, query = {}) => {
  const filterResult = await buildPostListScopeFilter(req, query);
  if (!filterResult.ok) {
    return fail(filterResult.status, filterResult.message);
  }

  const postFilter = filterResult.filter;

  const [published, hidden, removed, reportCounts] = await Promise.all([
    PartnerPost.countDocuments({ ...postFilter, status: POST_STATUS_PUBLISHED }),
    PartnerPost.countDocuments({ ...postFilter, status: POST_STATUS_HIDDEN }),
    PartnerPost.countDocuments({ ...postFilter, status: POST_STATUS_REMOVED }),
    countReportStatusesForPostFilter(postFilter),
  ]);

  return ok(200, {
    message: 'Post counts fetched successfully.',
    counts: {
      published,
      hidden,
      removed,
      pending: reportCounts.pending,
      reviewed: reportCounts.reviewed,
      dismissed: reportCounts.dismissed,
    },
  });
};

const listReports = async (query) => {
  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(parsePositiveInt(query.limit, DEFAULT_LIMIT), MAX_ADMIN_LIMIT);
  const skip = (page - 1) * limit;

  const filter = {};
  const status = query.status != null ? normalizeReportStatus(query.status) : REPORT_STATUS_PENDING;
  if (status) {
    filter.status = status;
  } else if (query.status !== undefined && String(query.status).trim() !== '') {
    return fail(400, 'Invalid report status filter.');
  }

  const [totalItems, reports] = await Promise.all([
    PartnerPostReport.countDocuments(filter),
    PartnerPostReport.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const postIds = [...new Set(reports.map((r) => String(r.post_id)))];
  const userIds = [...new Set(reports.map((r) => String(r.user_id)))];

  const [posts, users] = await Promise.all([
    postIds.length
      ? PartnerPost.find({ _id: { $in: postIds } }).lean()
      : [],
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select('_id name phone_number type')
          .lean()
      : [],
  ]);

  const postById = new Map(posts.map((p) => [String(p._id), p]));
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const partnerIds = [...new Set(posts.map((p) => String(p.partner_id)).filter(Boolean))];
  const partners = partnerIds.length
    ? await User.find({ _id: { $in: partnerIds } })
        .select('_id name profile_url')
        .lean()
    : [];
  const partnerById = new Map(partners.map((p) => [String(p._id), p]));

  const records = reports.map((report) => {
    const post = postById.get(String(report.post_id));
    const reporter = userById.get(String(report.user_id));
    const partner = post ? partnerById.get(String(post.partner_id)) : null;

    return {
      _id: report._id,
      reason: report.reason,
      details: report.details,
      status: report.status,
      created_at: report.created_at,
      updated_at: report.updated_at,
      reporter: reporter
        ? {
            _id: reporter._id,
            name: reporter.name,
            phone_number: reporter.phone_number,
          }
        : null,
      post: post
        ? {
            _id: post._id,
            description: post.description,
            status: post.status,
            image_urls: post.image_urls,
            partner: partner
              ? { _id: partner._id, name: partner.name, profile_url: partner.profile_url }
              : null,
          }
        : null,
    };
  });

  const totalPages = Math.ceil(totalItems / limit) || 0;

  return ok(200, {
    message: 'Reports retrieved successfully.',
    data: {
      records,
      totalItems,
      totalPages,
      currentPage: page,
      limit,
    },
  });
};

const listAllPosts = async (query) => {
  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(parsePositiveInt(query.limit, DEFAULT_LIMIT), MAX_ADMIN_LIMIT);
  const skip = (page - 1) * limit;

  const filter = { deleted_at: null };

  if (query.status !== undefined && String(query.status).trim() !== '') {
    const status = normalizePostStatus(query.status);
    if (!status) {
      return fail(400, 'Invalid post status filter.');
    }
    filter.status = status;
  }

  if (query.partner_id) {
    const parsed = parseObjectId(query.partner_id, 'partner_id');
    if (!parsed.ok) return fail(400, parsed.message);
    filter.partner_id = parsed.oid;
  }

  if (query.franchise_id) {
    const parsed = parseObjectId(query.franchise_id, 'franchise_id');
    if (!parsed.ok) return fail(400, parsed.message);
    filter.franchise_id = parsed.oid;
  }

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

const moderatePost = async (postId, body) => {
  const parsed = parseObjectId(postId, 'post_id');
  if (!parsed.ok) return fail(400, parsed.message);

  const status = normalizePostStatus(body.status);
  if (!status) {
    return fail(400, 'status must be one of: published, hidden, removed.');
  }

  const post = await PartnerPost.findOne({ _id: parsed.oid, deleted_at: null });
  if (!post) {
    return fail(404, 'Post not found.');
  }

  post.status = status;
  post.updated_at = new Date();
  await post.save();

  const mapped = await mapPostRecords([post.toObject()], { includePartner: true });
  return ok(200, { message: 'Post moderated successfully.', post: mapped[0] });
};

const updateReportStatus = async (reportId, body) => {
  const parsed = parseObjectId(reportId, 'report_id');
  if (!parsed.ok) return fail(400, parsed.message);

  const status = normalizeReportStatus(body.status);
  if (!status || status === REPORT_STATUS_PENDING) {
    return fail(400, 'status must be reviewed or dismissed.');
  }

  const report = await PartnerPostReport.findById(parsed.oid);
  if (!report) {
    return fail(404, 'Report not found.');
  }

  report.status = status;
  report.updated_at = new Date();
  await report.save();

  return ok(200, { message: 'Report updated successfully.', report });
};

module.exports = {
  getPostCounts,
  listReports,
  listAllPosts,
  moderatePost,
  updateReportStatus,
};
