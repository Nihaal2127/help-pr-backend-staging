const mongoose = require("mongoose");
const User = require("../../../models/user");
const Service = require("../../../models/service");
const OrderService = require("../../../models/order_services");
const PartnerServiceRating = require("../../../models/partner_service_rating");
const { USER_TYPE_PARTNER } = require("../../../constants/user_types");
const {
  mapRatingSummary,
  attachServiceRatingFields,
} = require("../../../utils/rating_format");
const {
  resolveFranchiseById,
  loadSubscribedFranchisePartners,
} = require("./franchise_partner_scope");

const { fail, ok } = require('../../../utils/mobile_service_result');

const parseReviewLimit = (raw) => {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.min(n, 20);
};

const assertPartnerInFranchise = async (partnerId, franchiseId) => {
  const partnerKey = String(partnerId ?? "").trim();
  if (!partnerKey || !mongoose.Types.ObjectId.isValid(partnerKey)) {
    return fail(400, "partnerId must be a valid ObjectId.");
  }

  const franchiseIdRaw =
    franchiseId !== undefined && franchiseId !== null ? String(franchiseId).trim() : "";

  let franchiseCtx = null;
  const partnerQuery = {
    _id: partnerKey,
    type: USER_TYPE_PARTNER,
    verification_status: 2,
    is_active: true,
    is_blocked: { $ne: true },
    deleted_at: null,
  };

  if (franchiseIdRaw) {
    franchiseCtx = await resolveFranchiseById(franchiseIdRaw);
    if (!franchiseCtx.ok) {
      return fail(franchiseCtx.status, franchiseCtx.message);
    }
    partnerQuery.franchise_id = franchiseCtx.franchise._id;
  }

  const partner = await User.findOne(partnerQuery)
    .select("name profile_url user_id average_rating rating_count franchise_id")
    .lean();

  if (!partner) {
    return fail(404, "Partner not found.");
  }

  if (!franchiseCtx) {
    if (!partner.franchise_id) {
      return fail(404, "Partner not found.");
    }
    franchiseCtx = await resolveFranchiseById(partner.franchise_id);
    if (!franchiseCtx.ok) {
      return fail(franchiseCtx.status, franchiseCtx.message);
    }
  }

  const subscribed = await loadSubscribedFranchisePartners(franchiseCtx.franchise._id);
  if (!subscribed.planByPartnerId.has(String(partner._id))) {
    return fail(404, "Partner not found.");
  }

  return ok(200, { partner, franchise: franchiseCtx.franchise });
};

const getPartnerRatingsSummary = async (partnerId, query = {}) => {
  try {
    const partnerResult = await assertPartnerInFranchise(partnerId, query.franchise_id);
    if (!partnerResult.ok) return partnerResult;

    const { partner, franchise } = partnerResult.data;
    const partnerOid = partner._id;

    const serviceIdRaw =
      query.service_id !== undefined && query.service_id !== null
        ? String(query.service_id).trim()
        : "";
    if (serviceIdRaw && !mongoose.Types.ObjectId.isValid(serviceIdRaw)) {
      return fail(400, "service_id must be a valid ObjectId.");
    }

    const reviewLimit = parseReviewLimit(query.review_limit);

    const partnerServiceFilter = {
      partner_id: partnerOid,
      deleted_at: null,
      rating_count: { $gt: 0 },
    };
    if (serviceIdRaw) {
      partnerServiceFilter.service_id = new mongoose.Types.ObjectId(serviceIdRaw);
    }

    const [partnerServiceRows, recentReviewLines] = await Promise.all([
      PartnerServiceRating.find(partnerServiceFilter).sort({ average_rating: -1 }).lean(),
      OrderService.find({
        partner_id: partnerOid,
        rating: { $gt: 0 },
        deleted_at: null,
        ...(serviceIdRaw
          ? { service_id: new mongoose.Types.ObjectId(serviceIdRaw) }
          : {}),
      })
        .sort({ reviewed_at: -1, updated_at: -1 })
        .limit(reviewLimit)
        .select(
          "order_unique_id rating review_text reviewed_at service_id order_id user_id"
        )
        .populate({ path: "service_id", select: "name service_id" })
        .lean(),
    ]);

    const serviceIds = [
      ...new Set(partnerServiceRows.map((row) => String(row.service_id))),
    ];
    const serviceDocs =
      serviceIds.length > 0
        ? await Service.find({ _id: { $in: serviceIds }, deleted_at: null })
            .select("name service_id average_rating rating_count")
            .lean()
        : [];
    const serviceById = new Map(serviceDocs.map((s) => [String(s._id), s]));

    const service_ratings = partnerServiceRows.map((row) => {
      const svc = serviceById.get(String(row.service_id));
      const partnerSvc = mapRatingSummary(row);
      const globalSvc = mapRatingSummary(svc);
      return {
        service_id: row.service_id,
        service_name: svc?.name ?? null,
        service_code: svc?.service_id ?? null,
        ...partnerSvc,
        service_average_rating: globalSvc.average_rating,
        service_rating_count: globalSvc.rating_count,
      };
    });

    const recent_reviews = recentReviewLines.map((line) => ({
      order_id: line.order_id,
      order_unique_id: line.order_unique_id,
      service_id: line.service_id?._id ?? line.service_id,
      service_name: line.service_id?.name ?? null,
      rating: line.rating,
      review_text: line.review_text || "",
      reviewed_at: line.reviewed_at,
    }));

    return ok(200, {
      message: "Partner ratings fetched successfully.",
      data: {
        franchise_id: franchise._id,
        franchise_name: franchise.name,
        partner_id: partner._id,
        partner_name: partner.name,
        ...mapRatingSummary(partner),
        service_ratings,
        recent_reviews,
      },
    });
  } catch (err) {
    console.error("getPartnerRatingsSummary", err.message);
    return fail(500, "Internal server error.");
  }
};

/**
 * Attach global + partner-specific rating rollups to partner catalog services.
 */
const enrichPartnerCatalogWithRatings = async (partnerId, categories) => {
  if (!Array.isArray(categories) || categories.length === 0) {
    return categories;
  }

  const serviceIds = [];
  for (const cat of categories) {
    for (const svc of cat.services || []) {
      if (svc?.service_id) {
        serviceIds.push(new mongoose.Types.ObjectId(String(svc.service_id)));
      }
    }
  }
  if (serviceIds.length === 0) return categories;

  const partnerOid = new mongoose.Types.ObjectId(String(partnerId));

  const [partnerServiceRows, serviceRows] = await Promise.all([
    PartnerServiceRating.find({
      partner_id: partnerOid,
      service_id: { $in: serviceIds },
      deleted_at: null,
    })
      .select("service_id average_rating rating_count")
      .lean(),
    Service.find({ _id: { $in: serviceIds }, deleted_at: null })
      .select("average_rating rating_count")
      .lean(),
  ]);

  const partnerSvcMap = new Map(
    partnerServiceRows.map((row) => [String(row.service_id), row])
  );
  const globalSvcMap = new Map(serviceRows.map((row) => [String(row._id), row]));

  return categories.map((cat) => ({
    ...cat,
    services: (cat.services || []).map((svc) => {
      const sid = String(svc.service_id);
      const partnerRow = partnerSvcMap.get(sid);
      const globalRow = globalSvcMap.get(sid);
      return {
        ...svc,
        ...attachServiceRatingFields(partnerRow, globalRow),
      };
    }),
  }));
};

const resolveCatalogServiceId = (svc) => svc?.service_id ?? svc?._id ?? null;

/**
 * Attach per-service ratings to partner list/home cards (`categories[].services[]`).
 * Supports list shape (`services[]._id`) and profile shape (`services[].service_id`).
 */
const enrichPartnerListRecordsWithServiceRatings = async (records) => {
  if (!Array.isArray(records) || records.length === 0) {
    return records;
  }

  const partnerIds = new Set();
  const serviceIds = new Set();

  for (const partner of records) {
    if (!partner?._id) continue;
    partnerIds.add(String(partner._id));
    for (const cat of partner.categories || []) {
      for (const svc of cat.services || []) {
        const sid = resolveCatalogServiceId(svc);
        if (sid && mongoose.Types.ObjectId.isValid(String(sid))) {
          serviceIds.add(String(sid));
        }
      }
    }
  }

  if (partnerIds.size === 0 || serviceIds.size === 0) {
    return records;
  }

  const partnerOids = [...partnerIds].map((id) => new mongoose.Types.ObjectId(id));
  const serviceOids = [...serviceIds].map((id) => new mongoose.Types.ObjectId(id));

  const [partnerServiceRows, serviceRows] = await Promise.all([
    PartnerServiceRating.find({
      partner_id: { $in: partnerOids },
      service_id: { $in: serviceOids },
      deleted_at: null,
    })
      .select("partner_id service_id average_rating rating_count")
      .lean(),
    Service.find({ _id: { $in: serviceOids }, deleted_at: null })
      .select("average_rating rating_count")
      .lean(),
  ]);

  const partnerSvcMap = new Map(
    partnerServiceRows.map((row) => [`${String(row.partner_id)}:${String(row.service_id)}`, row])
  );
  const globalSvcMap = new Map(serviceRows.map((row) => [String(row._id), row]));

  return records.map((partner) => ({
    ...partner,
    categories: (partner.categories || []).map((cat) => ({
      ...cat,
      services: (cat.services || []).map((svc) => {
        const sidRaw = resolveCatalogServiceId(svc);
        if (!sidRaw) return svc;
        const sid = String(sidRaw);
        const partnerKey = `${String(partner._id)}:${sid}`;
        return {
          ...svc,
          ...attachServiceRatingFields(partnerSvcMap.get(partnerKey), globalSvcMap.get(sid)),
        };
      }),
    })),
  }));
};

module.exports = {
  getPartnerRatingsSummary,
  enrichPartnerCatalogWithRatings,
  enrichPartnerListRecordsWithServiceRatings,
};
