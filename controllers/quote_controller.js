const mongoose = require("mongoose");
const Quote = require("../models/quote");
const User = require("../models/user");
const Category = require("../models/category");
const Service = require("../models/service");
const Address = require("../models/address");
const Franchise = require("../models/franchise");
const City = require("../models/city");
const State = require("../models/state");
const Area = require("../models/area");
const { applyPagination } = require("../utils/pagination");
const { getQuoteSequenceId } = require("../helper/id_generator");
const { checkObjectIdExists } = require("../validator/id_validator");
const { sanitizeInput } = require("../validator/search_keyword_validator");
const {
  OrderCreationError,
  createOrderFromQuote,
} = require("../services/order_creation_service");
const {
  attachPartnerServiceToQuote,
  attachPartnerServiceToQuotes,
} = require("../utils/quote_partner_service");
const {
  resolveQuoteListScope,
  assertQuoteRecordAccess,
} = require("../utils/quote_access");
const {
  QUOTE_DASHBOARD_BUCKETS,
  QUOTE_STATUSES,
  TERMINAL_QUOTE_STATUSES,
  buildQuoteBucketFilter,
  canTransitionQuoteStatus,
  normalizeQuoteStatus,
  resolveQuoteStatus,
  formatQuoteForApi,
  formatQuoteRecords,
} = require("../enum/quote_status_enum");

const QUOTE_ADDRESS_POPULATE = {
  path: "address_id",
  select:
    "address landmark area area_id city_id state_id pincode contact_name contact_number",
  populate: [
    { path: "city_id", select: "name" },
    { path: "state_id", select: "name" },
    { path: "area_id", select: "name" },
  ],
};

const USER_TYPE_ADMIN = 1;
const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_CUSTOMER = 4;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

const QUOTE_SORT_WHITELIST = new Set([
  "created_at",
  "updated_at",
  "from_date",
  "to_date",
  "service_price",
  "status",
  "quote_sequence_id",
]);

const resolveQuoteSortField = (sortBy) => {
  const sb = String(sortBy || "").trim();
  return QUOTE_SORT_WHITELIST.has(sb) ? sb : "created_at";
};

const resolveQuoteSortDir = (req) => {
  const so = String(req.query.sort_order || "").toLowerCase();
  if (so === "asc") return 1;
  if (so === "desc") return -1;
  if (req.query.sort !== undefined) {
    const s = parseInt(req.query.sort, 10);
    return s === 1 ? 1 : -1;
  }
  return -1;
};

const parseQuoteFilterDate = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
};

const startOfUtcDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const endOfUtcDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

/** getAll query from_date / to_date — quotes whose schedule overlaps the filter window. */
const buildQuoteDateRangeFilter = (query) => {
  const hasFrom =
    query.from_date !== undefined &&
    query.from_date !== null &&
    String(query.from_date).trim() !== "";
  const hasTo =
    query.to_date !== undefined &&
    query.to_date !== null &&
    String(query.to_date).trim() !== "";

  if (!hasFrom && !hasTo) {
    return { ok: true, filter: {} };
  }

  const parsedFrom = hasFrom ? parseQuoteFilterDate(query.from_date) : null;
  const parsedTo = hasTo ? parseQuoteFilterDate(query.to_date) : null;

  if (hasFrom && !parsedFrom) {
    return { ok: false, message: "Invalid from_date filter." };
  }
  if (hasTo && !parsedTo) {
    return { ok: false, message: "Invalid to_date filter." };
  }

  const rangeFrom = parsedFrom ? startOfUtcDay(parsedFrom) : null;
  const rangeTo = parsedTo ? endOfUtcDay(parsedTo) : null;

  if (rangeFrom && rangeTo && rangeTo < rangeFrom) {
    return {
      ok: false,
      message: "to_date filter must be on or after from_date filter.",
    };
  }

  const filter = {};
  if (rangeFrom) {
    filter.to_date = { $gte: rangeFrom };
  }
  if (rangeTo) {
    filter.from_date = { $lte: rangeTo };
  }

  return { ok: true, filter };
};

const resolveQuoteListStatusFilter = (statusParam) => {
  if (statusParam === undefined || statusParam === null) {
    return { ok: true, filter: {} };
  }

  const raw = String(statusParam).trim();
  if (raw === "") {
    return { ok: true, filter: {} };
  }

  const bucketKey = raw.toLowerCase();
  if (bucketKey === "fail") {
    return { ok: true, filter: buildQuoteBucketFilter("failed") };
  }
  if (QUOTE_DASHBOARD_BUCKETS.includes(bucketKey)) {
    return { ok: true, filter: buildQuoteBucketFilter(bucketKey) };
  }

  return {
    ok: false,
    message: `Invalid status. Use one of: ${QUOTE_STATUSES.join(", ")}.`,
  };
};

const getCallerId = (req) =>
  (req && req.user && (req.user.id || req.user._id)) || null;

const mapUserTypeToRole = (type) => {
  switch (Number(type)) {
    case USER_TYPE_ADMIN:
      return "admin";
    case USER_TYPE_PARTNER:
      return "partner";
    case USER_TYPE_EMPLOYEE:
      return "employee";
    case USER_TYPE_CUSTOMER:
      return "customer";
    case USER_TYPE_SUPER_ADMIN:
      return "super_admin";
    case USER_TYPE_STAFF:
      return "staff";
    default:
      return "user";
  }
};

const resolveQuoteActor = async (quote, req) => {
  const callerId = getCallerId(req);
  if (!callerId || !mongoose.Types.ObjectId.isValid(callerId)) {
    return {
      actor_id: null,
      actor_role: "system",
      actor_name: "",
      actor_unique_id: "",
    };
  }

  const actor = await User.findOne({ _id: callerId, deleted_at: null })
    .select("name user_id type franchise_id")
    .lean();

  if (!actor) {
    return {
      actor_id: new mongoose.Types.ObjectId(callerId),
      actor_role: "user",
      actor_name: "",
      actor_unique_id: "",
    };
  }

  let actorRole = mapUserTypeToRole(actor.type);
  const callerStr = String(callerId);
  if (quote.user_id && String(quote.user_id) === callerStr) {
    actorRole = "customer";
  } else if (quote.employee_id && String(quote.employee_id) === callerStr) {
    actorRole = "assigned_employee";
  } else if (
    Number(actor.type) === USER_TYPE_ADMIN &&
    actor.franchise_id &&
    quote.franchise_id &&
    String(actor.franchise_id) === String(quote.franchise_id)
  ) {
    actorRole = "franchise_admin";
  }

  return {
    actor_id: actor._id,
    actor_role: actorRole,
    actor_name: actor.name || "",
    actor_unique_id: actor.user_id || "",
  };
};

const serializeHistoryValue = (value) => {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) {
    return String(value);
  }
  if (value && value._id && mongoose.Types.ObjectId.isValid(value._id)) {
    return String(value._id);
  }
  return value;
};

const valuesAreEqual = (oldValue, newValue) =>
  JSON.stringify(serializeHistoryValue(oldValue)) ===
  JSON.stringify(serializeHistoryValue(newValue));

const buildHistoryChange = (field, oldValue, newValue) => {
  if (valuesAreEqual(oldValue, newValue)) return null;
  return {
    field,
    old_value: serializeHistoryValue(oldValue),
    new_value: serializeHistoryValue(newValue),
  };
};

const appendQuoteHistory = async (
  quote,
  req,
  eventType,
  changes = [],
  notes = ""
) => {
  const actor = await resolveQuoteActor(quote, req);
  if (!Array.isArray(quote.history)) {
    quote.history = [];
  }
  quote.history.push({
    event_type: eventType,
    ...actor,
    changes: changes.filter(Boolean),
    notes: notes ? String(notes).trim() : "",
    at: new Date(),
  });
};

const create = async (req, res) => {
  try {
    const body = req.body;
    const quote_sequence_id = await getQuoteSequenceId();

    const quote = new Quote({
      quote_sequence_id,
      user_id: body.user_id,
      partner_id: body.partner_id,
      employee_id:
        body.employee_id !== undefined &&
        body.employee_id !== null &&
        body.employee_id !== ""
          ? body.employee_id
          : null,
      created_by_id:
        body.created_by_id !== undefined &&
        body.created_by_id !== null &&
        body.created_by_id !== ""
          ? body.created_by_id
          : null,
      category_id: body.category_id,
      service_id: body.service_id,
      franchise_id: body.franchise_id,
      address_id: body.address_id,
      service_price: parseFloat(body.service_price),
      status: body.partner_id ? "pending" : "new",
      from_date: body.from_date,
      to_date: body.to_date,
      work_hours_per_day: parseFloat(body.work_hours_per_day),
      total_work_hours: parseFloat(body.total_work_hours),
      work_start_time: String(body.work_start_time).trim(),
      work_end_time: String(body.work_end_time).trim(),
      quote_description:
        typeof body.quote_description === "string"
          ? body.quote_description.trim()
          : "",
    });

    await appendQuoteHistory(quote, req, "created", [], "Quote created.");
    await quote.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Quote created successfully.",
      record: { quote_id: quote._id, quote_sequence_id: quote.quote_sequence_id },
    });
  } catch (error) {
    console.error("Error creating quote:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
      error: error.message,
    });
  }
};

const getAll = async (req, res) => {
  try {
    const scopeResult = await resolveQuoteListScope(req, {
      franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scopeResult.ok) {
      return res.status(scopeResult.status).json({
        success: false,
        status: scopeResult.status,
        message: scopeResult.message,
      });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const statusFilterResult = resolveQuoteListStatusFilter(req.query.status);
    if (!statusFilterResult.ok) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: statusFilterResult.message,
      });
    }

    const includeHistory = ["true", "1"].includes(
      String(req.query.include_history || "").toLowerCase()
    );

    const rawSearch = req.query.search;
    const searchTerm =
      rawSearch !== undefined &&
      rawSearch !== null &&
      String(rawSearch).trim() !== ""
        ? sanitizeInput(String(rawSearch).trim())
        : "";
    const regex = searchTerm ? new RegExp(searchTerm, "i") : null;

    const dateRangeResult = buildQuoteDateRangeFilter(req.query);
    if (!dateRangeResult.ok) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: dateRangeResult.message,
      });
    }

    const baseFilter = {
      deleted_at: null,
      ...scopeResult.filter,
      ...dateRangeResult.filter,
      ...statusFilterResult.filter,
      ...(req.query.user_id &&
        mongoose.Types.ObjectId.isValid(req.query.user_id) && {
          user_id: new mongoose.Types.ObjectId(req.query.user_id),
        }),
      ...(req.query.partner_id &&
        mongoose.Types.ObjectId.isValid(req.query.partner_id) && {
          partner_id: new mongoose.Types.ObjectId(req.query.partner_id),
        }),
      ...(req.query.employee_id &&
        mongoose.Types.ObjectId.isValid(req.query.employee_id) && {
          employee_id: new mongoose.Types.ObjectId(req.query.employee_id),
        }),
      ...(req.query.category_id &&
        mongoose.Types.ObjectId.isValid(req.query.category_id) && {
          category_id: new mongoose.Types.ObjectId(req.query.category_id),
        }),
      ...(req.query.service_id &&
        mongoose.Types.ObjectId.isValid(req.query.service_id) && {
          service_id: new mongoose.Types.ObjectId(req.query.service_id),
        }),
    };

    const sortField = resolveQuoteSortField(req.query.sort_by);
    const sortDir = resolveQuoteSortDir(req);
    const sortStage = { [sortField]: sortDir };

    const usersColl = User.collection.name;
    const categoriesColl = Category.collection.name;
    const servicesColl = Service.collection.name;
    const franchiseColl = Franchise.collection.name;
    const addressColl = Address.collection.name;
    const citiesColl = City.collection.name;
    const statesColl = State.collection.name;
    const areasColl = Area.collection.name;

    const pipeline = [
      { $match: baseFilter },
      {
        $lookup: {
          from: usersColl,
          localField: "user_id",
          foreignField: "_id",
          as: "_user",
        },
      },
      {
        $lookup: {
          from: usersColl,
          localField: "partner_id",
          foreignField: "_id",
          as: "_partner",
        },
      },
      {
        $lookup: {
          from: usersColl,
          localField: "employee_id",
          foreignField: "_id",
          as: "_employee",
        },
      },
      {
        $lookup: {
          from: usersColl,
          localField: "created_by_id",
          foreignField: "_id",
          as: "_created_by",
        },
      },
      {
        $lookup: {
          from: categoriesColl,
          localField: "category_id",
          foreignField: "_id",
          as: "_category",
        },
      },
      {
        $lookup: {
          from: servicesColl,
          localField: "service_id",
          foreignField: "_id",
          as: "_service",
        },
      },
      {
        $lookup: {
          from: franchiseColl,
          localField: "franchise_id",
          foreignField: "_id",
          as: "_franchise",
        },
      },
      {
        $lookup: {
          from: addressColl,
          localField: "address_id",
          foreignField: "_id",
          as: "_address",
        },
      },
      { $unwind: { path: "$_user", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_partner", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_employee", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_created_by", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_category", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_service", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_franchise", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_address", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: citiesColl,
          localField: "_address.city_id",
          foreignField: "_id",
          as: "_addr_city",
        },
      },
      {
        $lookup: {
          from: statesColl,
          localField: "_address.state_id",
          foreignField: "_id",
          as: "_addr_state",
        },
      },
      {
        $lookup: {
          from: areasColl,
          localField: "_address.area_id",
          foreignField: "_id",
          as: "_addr_area",
        },
      },
      { $unwind: { path: "$_addr_city", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_addr_state", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_addr_area", preserveNullAndEmptyArrays: true } },
      ...(regex
        ? [
            {
              $match: {
                $or: [
                  { quote_sequence_id: regex },
                  { quote_description: regex },
                  { "_user.name": regex },
                  { "_user.user_id": regex },
                  { "_user.email": regex },
                  { "_user.phone_number": regex },
                  { "_partner.name": regex },
                  { "_partner.user_id": regex },
                  { "_partner.email": regex },
                  { "_partner.phone_number": regex },
                  { "_employee.name": regex },
                  { "_employee.user_id": regex },
                  { "_created_by.name": regex },
                  { "_created_by.user_id": regex },
                  { "_category.name": regex },
                  { "_service.name": regex },
                  { "_service.rejection_reason": regex },
                  { "_category.rejection_reason": regex },
                  { "_franchise.name": regex },
                ],
              },
            },
          ]
        : []),
      { $sort: sortStage },
      {
        $addFields: {
          user_name: "$_user.name",
          user_unique_id: "$_user.user_id",
          partner_name: "$_partner.name",
          partner_unique_id: "$_partner.user_id",
          employee_name: "$_employee.name",
          category_name: "$_category.name",
          service_name: "$_service.name",
          user_id: {
            $cond: [
              { $ifNull: ["$_user._id", false] },
              {
                _id: "$_user._id",
                name: "$_user.name",
                user_id: "$_user.user_id",
                email: "$_user.email",
                phone_number: "$_user.phone_number",
                profile_url: "$_user.profile_url",
                type: "$_user.type",
              },
              null,
            ],
          },
          partner_id: {
            $cond: [
              { $ifNull: ["$_partner._id", false] },
              {
                _id: "$_partner._id",
                name: "$_partner.name",
                user_id: "$_partner.user_id",
                email: "$_partner.email",
                phone_number: "$_partner.phone_number",
                profile_url: "$_partner.profile_url",
                type: "$_partner.type",
              },
              null,
            ],
          },
          employee_id: {
            $cond: [
              { $ifNull: ["$_employee._id", false] },
              {
                _id: "$_employee._id",
                name: "$_employee.name",
                user_id: "$_employee.user_id",
                email: "$_employee.email",
                phone_number: "$_employee.phone_number",
                profile_url: "$_employee.profile_url",
                type: "$_employee.type",
              },
              null,
            ],
          },
          created_by_id: {
            $cond: [
              { $ifNull: ["$_created_by._id", false] },
              {
                _id: "$_created_by._id",
                name: "$_created_by.name",
                user_id: "$_created_by.user_id",
                email: "$_created_by.email",
                phone_number: "$_created_by.phone_number",
                profile_url: "$_created_by.profile_url",
                type: "$_created_by.type",
              },
              null,
            ],
          },
          category_id: {
            $cond: [
              { $ifNull: ["$_category._id", false] },
              {
                _id: "$_category._id",
                name: "$_category.name",
                category_id: "$_category.category_id",
                desc: "$_category.desc",
                image_url: "$_category.image_url",
                approval_status: "$_category.approval_status",
                is_request: "$_category.is_request",
                is_active: "$_category.is_active",
                rejection_reason: "$_category.rejection_reason",
              },
              null,
            ],
          },
          service_id: {
            $cond: [
              { $ifNull: ["$_service._id", false] },
              {
                _id: "$_service._id",
                name: "$_service.name",
                service_id: "$_service.service_id",
                desc: "$_service.desc",
                image_url: "$_service.image_url",
                price: "$_service.price",
                approval_status: "$_service.approval_status",
                is_request: "$_service.is_request",
                is_active: "$_service.is_active",
                rejection_reason: "$_service.rejection_reason",
              },
              null,
            ],
          },
          franchise_id: {
            $cond: [
              { $ifNull: ["$_franchise._id", false] },
              {
                _id: "$_franchise._id",
                name: "$_franchise.name",
                city_name: "$_franchise.city_name",
                state_name: "$_franchise.state_name",
              },
              null,
            ],
          },
          address_id: {
            $cond: [
              { $ifNull: ["$_address._id", false] },
              {
                $mergeObjects: [
                  "$_address",
                  {
                    city_id: {
                      $cond: [
                        { $ifNull: ["$_addr_city._id", false] },
                        { _id: "$_addr_city._id", name: "$_addr_city.name" },
                        "$_address.city_id",
                      ],
                    },
                    state_id: {
                      $cond: [
                        { $ifNull: ["$_addr_state._id", false] },
                        { _id: "$_addr_state._id", name: "$_addr_state.name" },
                        "$_address.state_id",
                      ],
                    },
                    area_id: {
                      $cond: [
                        { $ifNull: ["$_addr_area._id", false] },
                        { _id: "$_addr_area._id", name: "$_addr_area.name" },
                        "$_address.area_id",
                      ],
                    },
                  },
                ],
              },
              null,
            ],
          },
        },
      },
      {
        $project: {
          _user: 0,
          _partner: 0,
          _employee: 0,
          _created_by: 0,
          _category: 0,
          _service: 0,
          _franchise: 0,
          _address: 0,
          _addr_city: 0,
          _addr_state: 0,
          _addr_area: 0,
          ...(!includeHistory && { history: 0 }),
        },
      },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "totalCount" }],
        },
      },
    ];

    const agg = Quote.aggregate(pipeline).collation({
      locale: "en",
      strength: 2,
    });

    const result = await agg.exec();
    const facet = result[0] || { data: [], totalCount: [] };
    const quotes = formatQuoteRecords(facet.data || []);
    const totalCount =
      facet.totalCount && facet.totalCount[0]
        ? facet.totalCount[0].totalCount
        : 0;
    const totalPages = Math.ceil(totalCount / limit) || 0;

    res.status(200).json({
      success: true,
      status: 200,
      message: "Quote list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage: page,
      records: quotes,
    });
  } catch (err) {
    console.error("Error fetching quotes:", err);
    res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
      error: err.message,
    });
  }
};

const getQuoteCounts = async (req, res) => {
  try {
    const scopeResult = await resolveQuoteListScope(req, {
      franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scopeResult.ok) {
      return res.status(scopeResult.status).json({
        success: false,
        status: scopeResult.status,
        message: scopeResult.message,
      });
    }

    const baseFilter = { deleted_at: null, ...scopeResult.filter };

    const [newCount, pendingCount, acceptedCount, successCount, failedCount] =
      await Promise.all([
        Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter("new") }),
        Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter("pending") }),
        Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter("accepted") }),
        Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter("success") }),
        Quote.countDocuments({ ...baseFilter, ...buildQuoteBucketFilter("failed") }),
      ]);

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Quote counts fetched successfully.",
      record: {
        new: newCount,
        pending: pendingCount,
        accepted: acceptedCount,
        success: successCount,
        failed: failedCount,
      },
    });
  } catch (error) {
    console.error("Error fetching quote counts:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
      error: error.message,
    });
  }
};

const getById = async (req, res) => {
  const { id } = req.params;

  try {
    const quote = await Quote.findOne({ _id: id, deleted_at: null })
      .populate([
        { path: "user_id", select: "name user_id email phone_number profile_url type" },
        { path: "partner_id", select: "name user_id email phone_number profile_url type" },
        { path: "employee_id", select: "name user_id email phone_number profile_url type" },
        { path: "created_by_id", select: "name user_id email phone_number profile_url type" },
        {
          path: "category_id",
          select:
            "name category_id desc image_url approval_status is_request is_active rejection_reason",
        },
        { path: "franchise_id", select: "name city_name state_name" },
        QUOTE_ADDRESS_POPULATE,
        { path: "order_id", select: "unique_id order_status total_price user_id" },
      ])
      .lean();

    if (!quote) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "No record found",
      });
    }

    const access = await assertQuoteRecordAccess(req, quote);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }

    await attachPartnerServiceToQuote(quote);

    res.status(200).json({
      success: true,
      status: 200,
      message: "Quote fetched successfully",
      record: formatQuoteForApi(quote),
    });
  } catch (error) {
    console.error("Error fetching quote:", error);
    res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const getCustomerQuotes = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    const user_id = req.query.user_id;
    if (!user_id || user_id.trim() === "") {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Please enter user id",
      });
    }

    const userResult = await checkObjectIdExists(User, user_id, "user");
    if (userResult.exists === false) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: userResult.message,
      });
    }

    const scopeResult = await resolveQuoteListScope(req, {
      franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scopeResult.ok) {
      return res.status(scopeResult.status).json({
        success: false,
        status: scopeResult.status,
        message: scopeResult.message,
      });
    }

    const filter = {
      deleted_at: null,
      user_id: new mongoose.Types.ObjectId(user_id),
      ...scopeResult.filter,
    };
    const sort = { created_at: -1 };

    const customerQuotePopulate = [
      { path: "user_id", select: "name user_id email phone_number profile_url type" },
      { path: "partner_id", select: "name user_id email phone_number profile_url type" },
      { path: "employee_id", select: "name user_id email phone_number profile_url type" },
      { path: "created_by_id", select: "name user_id email phone_number profile_url type" },
      {
        path: "category_id",
        select:
          "name category_id desc image_url approval_status is_request is_active rejection_reason",
      },
      { path: "franchise_id", select: "name city_name state_name" },
      QUOTE_ADDRESS_POPULATE,
      { path: "order_id", select: "unique_id order_status total_price user_id" },
    ];

    const { data: quotes, totalCount, totalPages, currentPage } =
      await applyPagination(Quote, filter, page, limit, sort, {}, customerQuotePopulate);

    await attachPartnerServiceToQuotes(quotes);

    res.status(200).json({
      success: true,
      status: 200,
      message: "Quote list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: formatQuoteRecords(quotes),
    });
  } catch (err) {
    console.error("Error fetching customer quotes:", err);
    res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
      error: err.message,
    });
  }
};

const QUOTE_FIELD_UPDATE_KEYS = [
  "partner_id",
  "employee_id",
  "category_id",
  "service_id",
  "franchise_id",
  "address_id",
  "service_price",
  "from_date",
  "to_date",
  "work_hours_per_day",
  "total_work_hours",
  "work_start_time",
  "work_end_time",
  "created_by_id",
  "quote_description",
];

const applyQuoteFieldUpdates = (quote, body) => {
  const previousValues = {};

  for (const key of QUOTE_FIELD_UPDATE_KEYS) {
    if (body[key] !== undefined) {
      previousValues[key] = quote[key];
    }
  }

  for (const key of QUOTE_FIELD_UPDATE_KEYS) {
    if (body[key] === undefined) continue;

    if (key === "employee_id" && (body[key] === null || body[key] === "")) {
      quote.employee_id = null;
    } else if (key === "created_by_id" && (body[key] === null || body[key] === "")) {
      quote.created_by_id = null;
    } else if (
      ["service_price", "work_hours_per_day", "total_work_hours"].includes(key)
    ) {
      quote[key] = parseFloat(body[key]);
    } else if (key === "quote_description") {
      quote.quote_description =
        typeof body[key] === "string" ? body[key].trim() : "";
    } else {
      quote[key] = body[key];
    }
  }

  return previousValues;
};

const applyQuoteStatusSideEffects = (quote, body, nextStatus) => {
  if (nextStatus === "failed") {
    if (body.rejection_reason !== undefined) {
      quote.rejection_reason = String(body.rejection_reason).trim();
    }
    if (body.cancellation_reason !== undefined) {
      quote.cancellation_reason = String(body.cancellation_reason).trim();
    }
  }
};

const update = async (req, res) => {
  const { id } = req.params;

  try {
    const quote = await Quote.findOne({ _id: id, deleted_at: null });

    if (!quote) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "No record found",
      });
    }

    const access = await assertQuoteRecordAccess(req, quote);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }

    const body = req.body;
    const normalizedStored = normalizeQuoteStatus(quote.status, quote);
    if (normalizedStored && normalizedStored !== quote.status) {
      quote.status = normalizedStored;
    }
    const currentStatus = resolveQuoteStatus(quote);
    const hasStatusUpdate = body.status !== undefined;
    const hasFieldUpdates = QUOTE_FIELD_UPDATE_KEYS.some(
      (key) => body[key] !== undefined
    );

    if (hasFieldUpdates && !["new", "pending"].includes(currentStatus)) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Only new or pending quotes can have their details updated.",
      });
    }

    const historyChanges = [];

    if (hasFieldUpdates) {
      const previousValues = applyQuoteFieldUpdates(quote, body);
      for (const key of Object.keys(previousValues)) {
        const change = buildHistoryChange(
          key,
          previousValues[key],
          quote[key]
        );
        if (change) historyChanges.push(change);
      }

      if (
        currentStatus === "new" &&
        quote.partner_id &&
        !hasStatusUpdate
      ) {
        historyChanges.push(
          buildHistoryChange("status", currentStatus, "pending")
        );
        quote.status = "pending";
      }
    }

    if (hasStatusUpdate) {
      const nextStatus = normalizeQuoteStatus(body.status, quote);
      if (!nextStatus) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: `Invalid status. Use one of: ${QUOTE_STATUSES.join(", ")}.`,
        });
      }

      const effectiveCurrent =
        hasFieldUpdates && quote.status === "pending" && currentStatus === "new"
          ? "pending"
          : currentStatus;

      if (nextStatus === "success") {
        if (quote.order_id) {
          const refreshed = await Quote.findById(quote._id);
          return res.status(200).json({
            success: true,
            status: 200,
            message: "Quote is already linked to an order.",
            record: formatQuoteForApi(refreshed),
            order: {
              order_id: refreshed.order_id,
            },
          });
        }

        if (effectiveCurrent !== "accepted") {
          return res.status(409).json({
            success: false,
            status: 409,
            message: "Only accepted quotes can be marked as success (order is created on success).",
          });
        }

        const oldStatus = quote.status;
        const oldOrderId = quote.order_id;
        const { order, unique_id } = await createOrderFromQuote(quote);
        const linkedQuote = await Quote.findById(quote._id);

        await appendQuoteHistory(
          linkedQuote,
          req,
          "status_updated",
          [
            buildHistoryChange("status", oldStatus, linkedQuote.status),
            buildHistoryChange("order_id", oldOrderId, linkedQuote.order_id),
          ],
          `Status set to success. Order ${unique_id} created.`
        );
        await linkedQuote.save();

        return res.status(200).json({
          success: true,
          status: 200,
          message: "Quote updated and order created successfully.",
          record: formatQuoteForApi(linkedQuote),
          order: {
            order_id: order._id,
            unique_id: order.unique_id || unique_id,
          },
        });
      }

      if (
        TERMINAL_QUOTE_STATUSES.has(effectiveCurrent) &&
        nextStatus !== effectiveCurrent
      ) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: `Quotes with status "${effectiveCurrent}" cannot be changed.`,
        });
      }

      if (
        !canTransitionQuoteStatus(effectiveCurrent, nextStatus)
      ) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: `Cannot change quote status from "${effectiveCurrent}" to "${nextStatus}".`,
        });
      }

      const oldStatus = quote.status;
      const oldRejectionReason = quote.rejection_reason;
      const oldCancellationReason = quote.cancellation_reason;

      applyQuoteStatusSideEffects(quote, body, nextStatus);
      quote.status = nextStatus;

      const statusChanges = [
        buildHistoryChange("status", oldStatus, quote.status),
      ];
      if (nextStatus === "failed") {
        statusChanges.push(
          buildHistoryChange(
            "rejection_reason",
            oldRejectionReason,
            quote.rejection_reason
          ),
          buildHistoryChange(
            "cancellation_reason",
            oldCancellationReason,
            quote.cancellation_reason
          )
        );
      }
      historyChanges.push(...statusChanges.filter(Boolean));
    }

    quote.updated_at = new Date();

    if (historyChanges.length > 0) {
      const eventType = hasStatusUpdate ? "status_updated" : "updated";
      const notes =
        hasStatusUpdate && body.status
          ? `Status set to ${normalizeQuoteStatus(body.status, quote)}.`
          : "";
      await appendQuoteHistory(quote, req, eventType, historyChanges, notes);
    }

    const updated = await quote.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: hasStatusUpdate
        ? "Quote status updated successfully"
        : "Quote updated successfully",
      record: formatQuoteForApi(updated),
    });
  } catch (error) {
    if (error instanceof OrderCreationError) {
      return res.status(error.status).json({
        success: false,
        status: error.status,
        message: error.message,
      });
    }
    if (error.message === "INVALID_SERVICE_USER") {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid user_id on service_items.",
      });
    }
    console.error("Error updating quote:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
      error: error.message,
    });
  }
};

const deleteQuote = async (req, res) => {
  const { id } = req.params;

  try {
    const quote = await Quote.findById(id);

    if (!quote || quote.deleted_at) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: quote ? "Quote is already deleted" : "No record found",
      });
    }

    const access = await assertQuoteRecordAccess(req, quote);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }

    const oldDeletedAt = quote.deleted_at;
    quote.deleted_at = new Date();
    quote.updated_at = new Date();
    await appendQuoteHistory(quote, req, "deleted", [
      buildHistoryChange("deleted_at", oldDeletedAt, quote.deleted_at),
    ]);
    await quote.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: "Quote deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting quote:", error);
    res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

module.exports = {
  create,
  getAll,
  getQuoteCounts,
  getById,
  getCustomerQuotes,
  update,
  deleteQuote,
};
