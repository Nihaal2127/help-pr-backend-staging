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
const Order = require("../models/order");
const { applyPagination } = require("../utils/pagination");
const { getQuoteSequenceId } = require("../helper/id_generator");
const { checkObjectIdExists } = require("../validator/id_validator");
const {
  USER_TYPE_ADMIN,
  USER_TYPE_CUSTOMER,
  mapUserTypeToRole,
} = require("../constants/user_types");
const { getCallerId } = require("../utils/auth_caller");
const {
  resolveSortField,
  resolveSortDir,
  resolveListStatusFilter,
  resolveListSearchRegex,
} = require("../utils/list_query_helpers");
const { buildQuoteDateRangeFilter } = require("../utils/schedule_date_filters");
const { buildObjectIdQueryFilters } = require("../utils/mongoose_helpers");
const {
  buildEntityListPipeline,
  parseFacetListResult,
  getListCollectionNames,
} = require("../utils/list_aggregation");
const { fieldLabel } = require("../utils/field_labels");
const {
  normalizeAdminDescription,
  formatRecordsForCaller,
} = require("../utils/admin_description_access");

const QUOTE_LIST_SEARCH_FIELDS = [
  "quote_sequence_id",
  "quote_description",
  "_user.name",
  "_user.user_id",
  "_user.email",
  "_user.phone_number",
  "_partner.name",
  "_partner.user_id",
  "_partner.email",
  "_partner.phone_number",
  "_employee.name",
  "_employee.user_id",
  "_created_by.name",
  "_created_by.user_id",
  "_category.name",
  "_service.name",
  "_service.rejection_reason",
  "_category.rejection_reason",
  "_franchise.name",
];
const {
  OrderCreationError,
  createOrderFromQuote,
} = require("../services/order_creation_service");
const {
  resolveQuotePricing,
  applyPricingToQuote,
  quotePricingInputChanged,
  buildQuotePricingBody,
  ensureQuotePricingForConversion,
} = require("../services/quote_pricing_service");
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
const {
  safeNotifyQuoteCreated,
  safeNotifyQuoteStatusChanged,
  safeNotifyQuoteAssigned,
} = require("../src/modules/notifications/services/domainHooks");

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

const QUOTE_SORT_WHITELIST = new Set([
  "created_at",
  "updated_at",
  "from_date",
  "to_date",
  "total_service_charge",
  "service_price",
  "total_price",
  "status",
  "quote_sequence_id",
]);

const resolveQuoteListStatusFilter = (statusParam) =>
  resolveListStatusFilter(statusParam, {
    buildFilter: (raw) => {
      const bucketKey = raw.toLowerCase();
      if (bucketKey === "fail") {
        return buildQuoteBucketFilter("failed");
      }
      if (QUOTE_DASHBOARD_BUCKETS.includes(bucketKey)) {
        return buildQuoteBucketFilter(bucketKey);
      }
      return null;
    },
    invalidMessage: `Invalid status. Use one of: ${QUOTE_STATUSES.join(", ")}.`,
  });

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

const handleQuotePricingError = (res, error) => {
  if (error instanceof OrderCreationError) {
    return res.status(error.status).json({
      success: false,
      status: error.status,
      message: error.message,
    });
  }
  return null;
};

const create = async (req, res) => {
  try {
    const body = req.body;
    const quote_sequence_id = await getQuoteSequenceId();

    let pricing;
    try {
      ({ pricing } = await resolveQuotePricing(body));
    } catch (pricingErr) {
      const handled = handleQuotePricingError(res, pricingErr);
      if (handled) return handled;
      throw pricingErr;
    }

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
      admin_description:
        body.admin_description !== undefined
          ? normalizeAdminDescription(body.admin_description)
          : null,
    });

    applyPricingToQuote(quote, pricing);

    await appendQuoteHistory(quote, req, "created", [], "Quote created.");
    await quote.save();

    void safeNotifyQuoteCreated({
      quote,
      actorUserId: getCallerId(req),
    });

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Quote created successfully.",
      record: {
        quote_id: quote._id,
        quote_sequence_id: quote.quote_sequence_id,
        pricing: {
          total_service_charge: quote.total_service_charge,
          commission_percent: quote.commission_percent,
          commission_amount: quote.commission_amount,
          tax_percent: quote.tax_percent,
          tax_amount: quote.tax_amount,
          sub_total: quote.sub_total,
          total_price: quote.total_price,
          minimum_deposit_percent: quote.minimum_deposit_percent,
          minimum_deposit_amount: quote.minimum_deposit_amount,
          service_price: quote.service_price,
        },
      },
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

    const regex = resolveListSearchRegex(req);

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
      ...buildObjectIdQueryFilters(req.query, [
        "user_id",
        "partner_id",
        "employee_id",
        "category_id",
        "service_id",
      ]),
    };

    const sortField = resolveSortField(req.query.sort_by, QUOTE_SORT_WHITELIST);
    const sortDir = resolveSortDir(req);
    const sortStage = { [sortField]: sortDir };

    const collections = getListCollectionNames({
      users: User,
      categories: Category,
      services: Service,
      franchise: Franchise,
      address: Address,
      cities: City,
      states: State,
      areas: Area,
      orders: Order,
    });

    const pipeline = buildEntityListPipeline({
      baseFilter,
      sortStage,
      skip,
      limit,
      regex,
      searchFields: QUOTE_LIST_SEARCH_FIELDS,
      collections,
      includeAreaOnAddress: true,
      includeOrderLookup: true,
      extraProject: !includeHistory ? { history: 0 } : {},
    });

    const result = await Quote.aggregate(pipeline)
      .collation({ locale: "en", strength: 2 })
      .exec();

    const { data: rawQuotes, totalCount, totalPages } = parseFacetListResult(
      result,
      limit
    );
    const quotes = formatQuoteRecords(rawQuotes);

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

    const callerId = getCallerId(req);
    if (
      Number(req?.user?.type) === USER_TYPE_CUSTOMER &&
      callerId &&
      String(callerId) !== String(user_id)
    ) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: "Customers can only view their own quotes.",
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
      records: formatRecordsForCaller(formatQuoteRecords(quotes), req),
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
  "from_date",
  "to_date",
  "work_hours_per_day",
  "total_work_hours",
  "work_start_time",
  "work_end_time",
  "created_by_id",
  "quote_description",
  "admin_description",
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
    } else if (["work_hours_per_day", "total_work_hours"].includes(key)) {
      quote[key] = parseFloat(body[key]);
    } else if (key === "quote_description") {
      quote.quote_description =
        typeof body[key] === "string" ? body[key].trim() : "";
    } else if (key === "admin_description") {
      quote.admin_description = normalizeAdminDescription(body[key]);
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
    let previousStatusForNotify = null;
    let notifyQuoteAssigned = false;
    const hasFieldUpdates =
      QUOTE_FIELD_UPDATE_KEYS.some((key) => body[key] !== undefined) ||
      quotePricingInputChanged(body);

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

      if (quotePricingInputChanged(body)) {
        const pricingSnapshotBefore = {
          total_service_charge: quote.total_service_charge,
          commission_amount: quote.commission_amount,
          tax_amount: quote.tax_amount,
          sub_total: quote.sub_total,
          total_price: quote.total_price,
        };

        try {
          const { pricing } = await resolveQuotePricing(
            buildQuotePricingBody(quote, body)
          );
          applyPricingToQuote(quote, pricing);
        } catch (pricingErr) {
          const handled = handleQuotePricingError(res, pricingErr);
          if (handled) return handled;
          throw pricingErr;
        }

        for (const key of Object.keys(pricingSnapshotBefore)) {
          const change = buildHistoryChange(
            key,
            pricingSnapshotBefore[key],
            quote[key]
          );
          if (change) historyChanges.push(change);
        }
      }

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
        notifyQuoteAssigned = true;
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

        try {
          await ensureQuotePricingForConversion(quote, body);
        } catch (pricingErr) {
          const handled = handleQuotePricingError(res, pricingErr);
          if (handled) return handled;
          throw pricingErr;
        }

        if (hasFieldUpdates) {
          if (historyChanges.length > 0) {
            await appendQuoteHistory(
              quote,
              req,
              "updated",
              historyChanges,
              "Quote details updated before order conversion."
            );
          }
          quote.updated_at = new Date();
          await quote.save();
        } else if (quote.isModified()) {
          quote.updated_at = new Date();
          await quote.save();
        }

        const oldStatus = quote.status;
        const oldOrderId = quote.order_id;
        const quoteForOrder = await Quote.findById(quote._id);
        const { order, unique_id } = await createOrderFromQuote(quoteForOrder, {
          actorUserId: getCallerId(req),
        });
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

        void safeNotifyQuoteStatusChanged({
          quote: linkedQuote,
          previousStatus: oldStatus,
          newStatus: linkedQuote.status,
          actorUserId: getCallerId(req),
        });

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
      previousStatusForNotify = oldStatus;
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

    if (notifyQuoteAssigned) {
      void safeNotifyQuoteAssigned({
        quote: updated,
        actorUserId: getCallerId(req),
      });
    } else if (hasStatusUpdate) {
      void safeNotifyQuoteStatusChanged({
        quote: updated,
        previousStatus: previousStatusForNotify,
        newStatus: resolveQuoteStatus(updated),
        actorUserId: getCallerId(req),
      });
    }

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
        message: `Invalid ${fieldLabel("user_id")} on ${fieldLabel("service_items")}.`,
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
