const mongoose = require("mongoose");
const Quote = require("../models/quote");
const Order = require("../models/order");
const OrderService = require("../models/order_services");
const User = require("../models/user");
const Category = require("../models/category");
const Service = require("../models/service");
const Address = require("../models/address");
const { applyPagination } = require("../utils/pagination");
const { getOrderId, getQuoteSequenceId } = require("../helper/id_generator");
const { checkObjectIdExists } = require("../validator/id_validator");
const { sanitizeInput } = require("../validator/search_keyword_validator");

const STATUS_PENDING = 1;
const STATUS_APPROVED = 2;
const STATUS_REJECTED = 3;
const STATUS_CONVERTED = 4;
const STATUS_CANCELLED = 5;

const ORDER_TYPE_DEFAULT = 2;

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

const combineDateAndTime = (dateValue, timeStr) => {
  if (!dateValue || !timeStr || typeof timeStr !== "string") return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  const parts = timeStr.trim().split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  d.setHours(h, m, 0, 0);
  return d;
};

const buildOrderStatusInfo = () => [
  { status: 1, updated_at: Date.now() },
  { status: 2, updated_at: null },
  { status: 3, updated_at: null },
  { status: 4, updated_at: null },
];

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
      status: STATUS_PENDING,
      from_date: body.from_date,
      to_date: body.to_date,
      work_hours_per_day: parseFloat(body.work_hours_per_day),
      total_work_hours: parseFloat(body.total_work_hours),
      work_start_time: String(body.work_start_time).trim(),
      work_end_time: String(body.work_end_time).trim(),
    });

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
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const status =
      req.query.status !== undefined ? parseInt(req.query.status, 10) : null;

    const rawKeyword = req.query.keyword;
    const keyword =
      rawKeyword !== undefined &&
      rawKeyword !== null &&
      String(rawKeyword).trim() !== ""
        ? sanitizeInput(String(rawKeyword).trim())
        : "";
    const regex = keyword ? new RegExp(keyword, "i") : null;

    const baseFilter = {
      deleted_at: null,
      ...(req.query.status !== undefined && !Number.isNaN(status) && { status }),
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
      ...(req.query.franchise_id &&
        mongoose.Types.ObjectId.isValid(req.query.franchise_id) && {
          franchise_id: new mongoose.Types.ObjectId(req.query.franchise_id),
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
      { $unwind: { path: "$_user", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_partner", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_employee", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_category", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$_service", preserveNullAndEmptyArrays: true } },
      ...(regex
        ? [
            {
              $match: {
                $or: [
                  { quote_sequence_id: regex },
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
                  { "_category.name": regex },
                  { "_service.name": regex },
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
        },
      },
      {
        $project: {
          _user: 0,
          _partner: 0,
          _employee: 0,
          _category: 0,
          _service: 0,
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
    const quotes = facet.data || [];
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
    const baseFilter = { deleted_at: null };

    if (req.query.franchise_id) {
      if (!mongoose.Types.ObjectId.isValid(req.query.franchise_id)) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: "Invalid franchise id.",
        });
      }
      baseFilter.franchise_id = new mongoose.Types.ObjectId(req.query.franchise_id);
    }

    const newFilter = {
      ...baseFilter,
      status: STATUS_PENDING,
      partner_id: null,
    };

    const pendingFilter = {
      ...baseFilter,
      status: STATUS_PENDING,
      partner_id: { $ne: null },
    };

    const acceptedFilter = {
      ...baseFilter,
      status: { $in: [STATUS_APPROVED, STATUS_CONVERTED] },
    };

    const successFilter = {
      ...baseFilter,
      status: STATUS_CONVERTED,
      order_id: { $ne: null },
    };

    const failedFilter = {
      ...baseFilter,
      status: STATUS_APPROVED,
      order_id: null,
    };

    const [newCount, pendingCount, acceptedCount, successCount, failedCount] =
      await Promise.all([
        Quote.countDocuments(newFilter),
        Quote.countDocuments(pendingFilter),
        Quote.countDocuments(acceptedFilter),
        Quote.countDocuments(successFilter),
        Quote.countDocuments(failedFilter),
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
        { path: "category_id", select: "name category_id desc image_url" },
        { path: "service_id", select: "name service_id desc image_url price" },
        { path: "franchise_id", select: "name city_name state_name" },
        {
          path: "address_id",
          select: "address landmark area city_id state_id pincode contact_name contact_number",
          populate: [
            { path: "city_id", select: "name" },
            { path: "state_id", select: "name" },
          ],
        },
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

    res.status(200).json({
      success: true,
      status: 200,
      message: "Quote fetched successfully",
      record: quote,
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

    const filter = {
      deleted_at: null,
      user_id: new mongoose.Types.ObjectId(user_id),
    };
    const sort = { created_at: -1 };

    const { data: quotes, totalCount, totalPages, currentPage } =
      await applyPagination(Quote, filter, page, limit, sort);

    res.status(200).json({
      success: true,
      status: 200,
      message: "Quote list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: quotes,
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

    if (quote.status !== STATUS_PENDING) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Only pending quotes can be updated.",
      });
    }

    const allowed = [
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
    ];

    const body = req.body;
    for (const key of allowed) {
      if (body[key] !== undefined) {
        if (key === "employee_id" && (body[key] === null || body[key] === "")) {
          quote.employee_id = null;
        } else if (key === "created_by_id" && (body[key] === null || body[key] === "")) {
          quote.created_by_id = null;
        } else if (
          ["service_price", "work_hours_per_day", "total_work_hours"].includes(key)
        ) {
          quote[key] = parseFloat(body[key]);
        } else {
          quote[key] = body[key];
        }
      }
    }

    quote.updated_at = new Date();
    const updated = await quote.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Quote updated successfully",
      record: updated,
    });
  } catch (error) {
    console.error("Error updating quote:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const approve = async (req, res) => {
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

    if (quote.status !== STATUS_PENDING) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Only pending quotes can be approved.",
      });
    }

    quote.status = STATUS_APPROVED;
    quote.updated_at = new Date();
    await quote.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Quote approved successfully",
      record: quote,
    });
  } catch (error) {
    console.error("Error approving quote:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const reject = async (req, res) => {
  const { id } = req.params;
  const { rejection_reason } = req.body;

  try {
    const quote = await Quote.findOne({ _id: id, deleted_at: null });

    if (!quote) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "No record found",
      });
    }

    if (quote.status !== STATUS_PENDING) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Only pending quotes can be rejected.",
      });
    }

    quote.status = STATUS_REJECTED;
    if (rejection_reason !== undefined) {
      quote.rejection_reason = String(rejection_reason).trim();
    }
    quote.updated_at = new Date();
    await quote.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Quote rejected successfully",
      record: quote,
    });
  } catch (error) {
    console.error("Error rejecting quote:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const cancelQuote = async (req, res) => {
  const { id } = req.params;
  const { cancellation_reason } = req.body;

  try {
    const quote = await Quote.findOne({ _id: id, deleted_at: null });

    if (!quote) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "No record found",
      });
    }

    if (quote.status !== STATUS_PENDING && quote.status !== STATUS_APPROVED) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Only pending or approved quotes can be cancelled.",
      });
    }

    quote.status = STATUS_CANCELLED;
    if (cancellation_reason !== undefined) {
      quote.cancellation_reason = String(cancellation_reason).trim();
    }
    quote.updated_at = new Date();
    await quote.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Quote cancelled successfully",
      record: quote,
    });
  } catch (error) {
    console.error("Error cancelling quote:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const convertToOrder = async (req, res) => {
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

    if (quote.status !== STATUS_APPROVED) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Only approved quotes can be converted to an order.",
      });
    }

    if (quote.order_id) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Quote has already been converted.",
      });
    }

    const addressDoc = await Address.findById(quote.address_id);
    if (!addressDoc) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Address not found for this quote.",
      });
    }

    const customer = await User.findById(quote.user_id);
    const partner = await User.findById(quote.partner_id);

    if (!customer || !partner) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Customer or partner user record missing.",
      });
    }

    const city_id = addressDoc.city_id;
    const addressStr =
      addressDoc.address ||
      [addressDoc.landmark, addressDoc.area].filter(Boolean).join(", ") ||
      "";

    const order_id = new mongoose.Types.ObjectId();
    const unique_id = await getOrderId();

    const service_from_time = combineDateAndTime(
      quote.from_date,
      quote.work_start_time
    );
    const service_to_time = combineDateAndTime(
      quote.from_date,
      quote.work_end_time
    );

    if (!service_from_time || !service_to_time) {
      return res.status(409).json({
        success: false,
        status: 409,
        message:
          "Could not build service times from from_date, work_start_time, and work_end_time.",
      });
    }

    const price = parseFloat(quote.service_price) || 0;

    const orderServiceDoc = {
      _id: new mongoose.Types.ObjectId(),
      order_id,
      user_id: quote.user_id,
      partner_id: quote.partner_id,
      order_unique_id: unique_id,
      user_unique_id: customer.user_id || "",
      partner_unique_id: partner.user_id || "",
      payment_mode_id: "",
      transaction_id: "",
      category_id: quote.category_id,
      service_id: quote.service_id,
      service_status: 1,
      service_date: quote.from_date,
      service_from_time,
      service_to_time,
      sub_total: price,
      tax: 0,
      user_paltform_fee: 0,
      partner_commison_platform_fee: 0,
      service_price: price,
      total_price: price,
      partner_earning: price,
      admin_earning: 0,
      is_paid: false,
      partner_paid_status: 1,
      rating: 0,
    };

    await OrderService.insertMany([orderServiceDoc]);

    const created_by_id =
      quote.created_by_id != null ? quote.created_by_id : quote.user_id;

    const newOrder = new Order({
      _id: order_id,
      unique_id,
      user_id: quote.user_id,
      user_unique_id: customer.user_id || "",
      type: ORDER_TYPE_DEFAULT,
      city_id,
      category_id: quote.category_id,
      order_status: 1,
      order_status_info: buildOrderStatusInfo(),
      address: addressStr,
      is_paid: false,
      payment_mode_id: "",
      transaction_id: "",
      created_by_id,
      service_items: [orderServiceDoc._id],
      order_date: quote.from_date,
      sub_total: price,
      tax: 0,
      discount_amount: null,
      user_paltform_fee: 0,
      partner_commison_platform_fee: 0,
      total_price: price,
      admin_earning: 0,
    });

    await newOrder.save();

    quote.order_id = order_id;
    quote.status = STATUS_CONVERTED;
    quote.updated_at = new Date();
    await quote.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Quote converted to order successfully.",
      record: {
        order_id: newOrder._id,
        unique_id: newOrder.unique_id,
        quote_id: quote._id,
        quote_sequence_id: quote.quote_sequence_id,
      },
    });
  } catch (error) {
    console.error("Error converting quote:", error);
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

    quote.deleted_at = new Date();
    quote.updated_at = new Date();
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
  approve,
  reject,
  cancelQuote,
  convertToOrder,
  deleteQuote,
};
