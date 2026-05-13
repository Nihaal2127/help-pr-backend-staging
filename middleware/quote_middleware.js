const mongoose = require("mongoose");
const Quote = require("../models/quote");
const User = require("../models/user");
const Category = require("../models/category");
const Service = require("../models/service");
const Franchise = require("../models/franchise");
const Address = require("../models/address");
const { checkObjectIdExists } = require("../validator/id_validator");

const USER_TYPE_ADMIN = 1;
const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_CUSTOMER = 4;

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const MAX_CUSTOMER_DESCRIPTION_LEN = 1000;

const getCallerId = (req) =>
  (req && req.user && (req.user.id || req.user._id)) || null;

const canEditCustomerDescription = async (quote, callerId) => {
  if (!callerId || !quote) return false;
  const callerStr = String(callerId);

  if (quote.user_id && String(quote.user_id) === callerStr) {
    return true;
  }

  if (quote.employee_id && String(quote.employee_id) === callerStr) {
    return true;
  }

  const caller = await User.findOne({
    _id: callerId,
    deleted_at: null,
  }).select("type franchise_id");
  if (!caller) return false;

  const isFranchiseAdmin =
    Number(caller.type) === USER_TYPE_ADMIN &&
    caller.franchise_id &&
    quote.franchise_id &&
    String(caller.franchise_id) === String(quote.franchise_id);

  return Boolean(isFranchiseAdmin);
};

const verifyUserType = async (userId, expectedType, label) => {
  if (!userId) {
    return { ok: false, message: `${label} is required.` };
  }
  const idResult = await checkObjectIdExists(User, userId, "user");
  if (!idResult.exists) {
    return { ok: false, message: idResult.message };
  }
  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, message: `${label} not found.` };
  }
  if (user.type !== expectedType) {
    return { ok: false, message: `${label} has invalid user type.` };
  }
  return { ok: true };
};

const parseDateEndOfDay = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const validateCommonFields = async (body, { partial } = { partial: false }) => {
  const {
    user_id,
    partner_id,
    employee_id,
    created_by_id,
    category_id,
    service_id,
    franchise_id,
    address_id,
    service_price,
    from_date,
    to_date,
    work_hours_per_day,
    total_work_hours,
    work_start_time,
    work_end_time,
    customer_description,
  } = body;

  if (!partial || user_id !== undefined) {
    const ur = await verifyUserType(user_id, USER_TYPE_CUSTOMER, "Customer (user_id)");
    if (!ur.ok) return ur;
  }

  if (!partial || partner_id !== undefined) {
    const pr = await verifyUserType(partner_id, USER_TYPE_PARTNER, "Partner (partner_id)");
    if (!pr.ok) return pr;
  }

  if (employee_id !== undefined && employee_id !== null && employee_id !== "") {
    const er = await verifyUserType(employee_id, USER_TYPE_EMPLOYEE, "Employee (employee_id)");
    if (!er.ok) return er;
  }

  if (created_by_id !== undefined && created_by_id !== null && created_by_id !== "") {
    const cr = await checkObjectIdExists(User, created_by_id, "user");
    if (!cr.exists) {
      return { ok: false, message: cr.message };
    }
  }

  if (!partial || category_id !== undefined) {
    const cat = await checkObjectIdExists(Category, category_id, "category");
    if (!cat.exists) return { ok: false, message: cat.message };
  }

  if (!partial || service_id !== undefined) {
    const sr = await checkObjectIdExists(Service, service_id, "service");
    if (!sr.exists) return { ok: false, message: sr.message };
  }

  if (!partial || franchise_id !== undefined) {
    const fr = await checkObjectIdExists(Franchise, franchise_id, "franchise");
    if (!fr.exists) return { ok: false, message: fr.message };
  }

  if (!partial || address_id !== undefined) {
    const ar = await checkObjectIdExists(Address, address_id, "address");
    if (!ar.exists) return { ok: false, message: ar.message };
  }

  if (!partial || service_price !== undefined) {
    const sp = parseFloat(service_price);
    if (service_price === undefined || Number.isNaN(sp) || sp < 0) {
      return { ok: false, message: "service_price must be a number >= 0." };
    }
  }

  if (!partial) {
    const from = parseDateEndOfDay(from_date);
    const to = parseDateEndOfDay(to_date);
    if (!from) return { ok: false, message: "from_date is required and must be valid." };
    if (!to) return { ok: false, message: "to_date is required and must be valid." };
    if (to < from) return { ok: false, message: "to_date must be on or after from_date." };
  } else {
    if (from_date !== undefined) {
      const from = parseDateEndOfDay(from_date);
      if (!from) return { ok: false, message: "from_date must be valid." };
    }
    if (to_date !== undefined) {
      const to = parseDateEndOfDay(to_date);
      if (!to) return { ok: false, message: "to_date must be valid." };
    }
  }

  if (!partial || work_hours_per_day !== undefined) {
    const wh = parseFloat(work_hours_per_day);
    if (
      work_hours_per_day === undefined ||
      Number.isNaN(wh) ||
      wh <= 0
    ) {
      return { ok: false, message: "work_hours_per_day must be greater than 0." };
    }
  }

  if (!partial || total_work_hours !== undefined) {
    const tw = parseFloat(total_work_hours);
    if (
      total_work_hours === undefined ||
      Number.isNaN(tw) ||
      tw <= 0
    ) {
      return { ok: false, message: "total_work_hours must be greater than 0." };
    }
  }

  if (!partial || work_start_time !== undefined) {
    if (!work_start_time || typeof work_start_time !== "string" || !TIME_REGEX.test(work_start_time.trim())) {
      return { ok: false, message: "work_start_time must be in HH:mm format." };
    }
  }

  if (!partial || work_end_time !== undefined) {
    if (!work_end_time || typeof work_end_time !== "string" || !TIME_REGEX.test(work_end_time.trim())) {
      return { ok: false, message: "work_end_time must be in HH:mm format." };
    }
  }

  if (customer_description !== undefined && customer_description !== null) {
    if (typeof customer_description !== "string") {
      return { ok: false, message: "customer_description must be a string." };
    }
    if (customer_description.trim().length > MAX_CUSTOMER_DESCRIPTION_LEN) {
      return {
        ok: false,
        message: `customer_description must be ${MAX_CUSTOMER_DESCRIPTION_LEN} characters or fewer.`,
      };
    }
  }

  return { ok: true };
};

const createQuoteMiddleware = async (req, res, next) => {
  const result = await validateCommonFields(req.body, { partial: false });
  if (!result.ok) {
    return res.status(409).json({
      success: false,
      status: 409,
      message: result.message,
    });
  }
  next();
};

const updateQuoteMiddleware = async (req, res, next) => {
  const body = req.body;
  const allowedKeys = new Set([
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
    "customer_description",
  ]);

  const unknown = Object.keys(body).filter((k) => !allowedKeys.has(k));
  if (unknown.length > 0) {
    return res.status(409).json({
      success: false,
      status: 409,
      message: `Cannot update fields: ${unknown.join(", ")}`,
    });
  }

  const partialBody = {};
  for (const key of allowedKeys) {
    if (body[key] !== undefined) partialBody[key] = body[key];
  }

  if (Object.keys(partialBody).length === 0) {
    return res.status(409).json({
      success: false,
      status: 409,
      message: "No updatable fields provided.",
    });
  }

  const merged = { ...req.body };
  const result = await validateCommonFields(merged, { partial: true });
  if (!result.ok) {
    return res.status(409).json({
      success: false,
      status: 409,
      message: result.message,
    });
  }

  const needsCrossValidation =
    partialBody.from_date !== undefined ||
    partialBody.to_date !== undefined;
  const needsDescriptionAuth = partialBody.customer_description !== undefined;

  if (needsCrossValidation || needsDescriptionAuth) {
    const quoteId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(quoteId)) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Invalid quote id.",
      });
    }
    const existing = await Quote.findById(quoteId).lean();
    if (!existing) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Quote not found.",
      });
    }

    if (needsDescriptionAuth) {
      const callerId = getCallerId(req);
      const allowed = await canEditCustomerDescription(existing, callerId);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          status: 403,
          message:
            "Only the customer, the assigned employee, or the franchise admin can edit customer_description.",
        });
      }
    }

    if (needsCrossValidation) {
      const from = parseDateEndOfDay(
        partialBody.from_date !== undefined ? partialBody.from_date : existing.from_date
      );
      const to = parseDateEndOfDay(
        partialBody.to_date !== undefined ? partialBody.to_date : existing.to_date
      );
      if (from && to && to < from) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: "to_date must be on or after from_date.",
        });
      }
    }
  }

  next();
};

const convertQuoteMiddleware = async (req, res, next) => {
  const { id } = req.params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(409).json({
      success: false,
      status: 409,
      message: "Invalid quote id.",
    });
  }
  next();
};

module.exports = {
  createQuoteMiddleware,
  updateQuoteMiddleware,
  convertQuoteMiddleware,
};
