const mongoose = require("mongoose");
const Quote = require("../models/quote");
const User = require("../models/user");
const Category = require("../models/category");
const Service = require("../models/service");
const Franchise = require("../models/franchise");
const Address = require("../models/address");
const { checkObjectIdExists } = require("../validator/id_validator");
const { QUOTE_STATUSES, normalizeQuoteStatus } = require("../enum/quote_status_enum");
const { resolveTotalServiceCharge } = require("../utils/order_pricing");
const { FIELD_LABELS, fieldLabel } = require("../utils/field_labels");
const {
  validateAdminDescriptionValue,
} = require("../utils/admin_description_access");
const { assertCanEditQuoteAdminDescription } = require("../utils/quote_access");

const USER_TYPE_ADMIN = 1;
const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_CUSTOMER = 4;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const MAX_QUOTE_DESCRIPTION_LEN = 1000;

/** Client must not send server-computed pricing; only total_service_charge / service_price. */
const DISALLOWED_CLIENT_PRICING_KEYS = [
  "commission_amount",
  "commission_percent",
  "tax_amount",
  "tax_percent",
  "sub_total",
  "total_price",
  "minimum_deposit_amount",
  "minimum_deposit_percent",
  "admin_commission",
  "discount_amount",
  "offer_id",
];

const rejectClientComputedPricing = (body, res) => {
  const sent = DISALLOWED_CLIENT_PRICING_KEYS.filter(
    (key) => body[key] !== undefined
  );
  if (sent.length === 0) return true;
  res.status(409).json({
    success: false,
    status: 409,
    message: `Do not send server-computed pricing fields: ${sent.map(fieldLabel).join(", ")}. Send only ${fieldLabel("total_service_charge")} (or ${fieldLabel("service_price")}).`,
  });
  return false;
};

const getCallerId = (req) =>
  (req && req.user && (req.user.id || req.user._id)) || null;

const canEditQuoteDescription = async (quote, callerId) => {
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

  const callerType = Number(caller.type);
  if (callerType === USER_TYPE_SUPER_ADMIN || callerType === USER_TYPE_STAFF) {
    return true;
  }

  const isFranchiseAdmin =
    callerType === USER_TYPE_ADMIN &&
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
    quote_description,
    admin_description,
  } = body;

  if (!partial || user_id !== undefined) {
    const ur = await verifyUserType(user_id, USER_TYPE_CUSTOMER, "Customer");
    if (!ur.ok) return ur;
  }

  if (!partial || partner_id !== undefined) {
    const pr = await verifyUserType(partner_id, USER_TYPE_PARTNER, "Partner");
    if (!pr.ok) return pr;
  }

  if (employee_id !== undefined && employee_id !== null && employee_id !== "") {
    const er = await verifyUserType(employee_id, USER_TYPE_EMPLOYEE, "Employee");
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

  const hasChargeInput =
    body.total_service_charge !== undefined || body.service_price !== undefined;
  if (!partial || hasChargeInput) {
    const charge = resolveTotalServiceCharge(body, {});
    if (!partial) {
      if (charge === null || charge <= 0) {
        return {
          ok: false,
          message:
            "total_service_charge (or service_price) is required and must be greater than 0.",
        };
      }
    } else if (hasChargeInput && (charge === null || charge <= 0)) {
      return {
        ok: false,
        message:
          "total_service_charge (or service_price) must be greater than 0.",
      };
    }
  }

  if (!partial) {
    const from = parseDateEndOfDay(from_date);
    const to = parseDateEndOfDay(to_date);
    if (!from) return { ok: false, message: "From date is required and must be valid." };
    if (!to) return { ok: false, message: "To date is required and must be valid." };
    if (to < from) return { ok: false, message: "To date must be on or after from date." };
  } else {
    if (from_date !== undefined) {
      const from = parseDateEndOfDay(from_date);
      if (!from) return { ok: false, message: "From date must be valid." };
    }
    if (to_date !== undefined) {
      const to = parseDateEndOfDay(to_date);
      if (!to) return { ok: false, message: "To date must be valid." };
    }
  }

  if (!partial || work_hours_per_day !== undefined) {
    const wh = parseFloat(work_hours_per_day);
    if (
      work_hours_per_day === undefined ||
      Number.isNaN(wh) ||
      wh <= 0
    ) {
      return { ok: false, message: "Work hours per day must be greater than 0." };
    }
  }

  if (!partial || total_work_hours !== undefined) {
    const tw = parseFloat(total_work_hours);
    if (
      total_work_hours === undefined ||
      Number.isNaN(tw) ||
      tw <= 0
    ) {
      return { ok: false, message: "Total work hours must be greater than 0." };
    }
  }

  if (!partial || work_start_time !== undefined) {
    if (!work_start_time || typeof work_start_time !== "string" || !TIME_REGEX.test(work_start_time.trim())) {
      return { ok: false, message: "Work start time must be in HH:mm format." };
    }
  }

  if (!partial || work_end_time !== undefined) {
    if (!work_end_time || typeof work_end_time !== "string" || !TIME_REGEX.test(work_end_time.trim())) {
      return { ok: false, message: "Work end time must be in HH:mm format." };
    }
  }

  if (quote_description !== undefined && quote_description !== null) {
    if (typeof quote_description !== "string") {
      return { ok: false, message: "Quote description must be a string." };
    }
    if (quote_description.trim().length > MAX_QUOTE_DESCRIPTION_LEN) {
      return {
        ok: false,
        message: `Quote description must be ${MAX_QUOTE_DESCRIPTION_LEN} characters or fewer.`,
      };
    }
  }

  const adminDescValidation = validateAdminDescriptionValue(admin_description);
  if (!adminDescValidation.ok) return adminDescValidation;

  return { ok: true };
};

const createQuoteMiddleware = async (req, res, next) => {
  if (!rejectClientComputedPricing(req.body, res)) return;
  const result = await validateCommonFields(req.body, { partial: false });
  if (!result.ok) {
    return res.status(409).json({
      success: false,
      status: 409,
      message: result.message,
    });
  }

  if (req.body.admin_description !== undefined) {
    const access = await assertCanEditQuoteAdminDescription(req, {
      franchise_id: req.body.franchise_id,
    });
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }
  }

  next();
};

const updateQuoteMiddleware = async (req, res, next) => {
  const body = req.body;
  if (!rejectClientComputedPricing(body, res)) return;
  const allowedKeys = new Set([
    "partner_id",
    "employee_id",
    "category_id",
    "service_id",
    "franchise_id",
    "address_id",
    "total_service_charge",
    "service_price",
    "from_date",
    "to_date",
    "work_hours_per_day",
    "total_work_hours",
    "work_start_time",
    "work_end_time",
    "created_by_id",
    "quote_description",
    "admin_description",
    "status",
    "rejection_reason",
    "cancellation_reason",
  ]);

  const unknown = Object.keys(body).filter((k) => !allowedKeys.has(k));
  if (unknown.length > 0) {
    return res.status(409).json({
      success: false,
      status: 409,
      message: `Cannot update fields: ${unknown.map(fieldLabel).join(", ")}`,
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

  if (partialBody.status !== undefined) {
    const normalized = normalizeQuoteStatus(partialBody.status);
    if (!normalized) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: `Invalid status. Use one of: ${QUOTE_STATUSES.join(", ")}.`,
      });
    }
    req.body.status = normalized;
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
  const needsDescriptionAuth = partialBody.quote_description !== undefined;
  const needsAdminDescriptionAuth = partialBody.admin_description !== undefined;

  if (needsCrossValidation || needsDescriptionAuth || needsAdminDescriptionAuth) {
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
      const allowed = await canEditQuoteDescription(existing, callerId);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          status: 403,
          message:
            "Only the customer, the assigned employee, the franchise admin, super admin, or staff can edit the quote description.",
        });
      }
    }

    if (needsAdminDescriptionAuth) {
      const access = await assertCanEditQuoteAdminDescription(req, existing);
      if (!access.ok) {
        return res.status(access.status).json({
          success: false,
          status: access.status,
          message: access.message,
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
          message: "To date must be on or after from date.",
        });
      }
    }
  }

  next();
};

module.exports = {
  createQuoteMiddleware,
  updateQuoteMiddleware,
};
