const { parseFilterDate } = require("../utils/date_bounds");
const { isMongoObjectIdHex } = require("../utils/mongoose_helpers");
const {
  normalizeAppointmentStatus,
  isValidAppointmentStatus,
} = require("../enum/appointment_status_enum");

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validateAppointmentIdParam = (req, res, next) => {
  try {
    const id = String(req.params.id ?? "").trim();
    if (!id) {
      return sendError(res, 400, "Appointment id is required.");
    }
    if (isMongoObjectIdHex(id)) {
      return next();
    }
    if (/^AP\d+$/i.test(id)) {
      return next();
    }
    return sendError(res, 400, "Invalid appointment id.");
  } catch (err) {
    console.error("validateAppointmentIdParam:", err.message);
    return sendError(res, 500, "Internal server error.");
  }
};

const validateOrderIdParam = (req, res, next) => {
  try {
    const id = String(req.params.orderId ?? "").trim();
    if (!id) {
      return sendError(res, 400, "Order id is required.");
    }
    if (id.length > 64) {
      return sendError(res, 400, "Invalid order id.");
    }
    if (isMongoObjectIdHex(id)) {
      return next();
    }
    if (/^[A-Za-z0-9_-]+$/.test(id)) {
      return next();
    }
    return sendError(res, 400, "Invalid order id.");
  } catch (err) {
    console.error("validateOrderIdParam:", err.message);
    return sendError(res, 500, "Internal server error.");
  }
};

const validateCreateAppointmentBody = (req, res, next) => {
  try {
    const { order_id, title, service_date } = req.body || {};

    if (!order_id || String(order_id).trim() === "") {
      return sendError(res, 400, "order_id is required.");
    }

    if (!parseFilterDate(service_date)) {
      return sendError(res, 400, "Valid service_date is required.");
    }

    if (title !== undefined && title !== null && String(title).length > 200) {
      return sendError(res, 400, "title must be 200 characters or fewer.");
    }

    if (
      req.body.status !== undefined &&
      req.body.status !== null &&
      String(req.body.status).trim() !== "" &&
      !isValidAppointmentStatus(req.body.status)
    ) {
      return sendError(
        res,
        400,
        "status must be one of: scheduled, in-progress, completed, cancelled."
      );
    }

    next();
  } catch (err) {
    console.error("validateCreateAppointmentBody:", err.message);
    return sendError(res, 500, "Internal server error.");
  }
};

const validateUpdateAppointmentBody = (req, res, next) => {
  try {
    const { title, status } = req.body || {};

    if (title !== undefined && title !== null && String(title).length > 200) {
      return sendError(res, 400, "title must be 200 characters or fewer.");
    }

    if (
      status !== undefined &&
      status !== null &&
      String(status).trim() !== "" &&
      !isValidAppointmentStatus(status)
    ) {
      return sendError(
        res,
        400,
        "status must be one of: scheduled, in-progress, completed, cancelled."
      );
    }

    if (
      req.body.service_date === undefined &&
      req.body.start_time === undefined &&
      req.body.end_time === undefined &&
      title === undefined &&
      status === undefined
    ) {
      return sendError(res, 400, "At least one field is required to update.");
    }

    if (req.body.status) {
      req.body.status = normalizeAppointmentStatus(req.body.status);
    }

    next();
  } catch (err) {
    console.error("validateUpdateAppointmentBody:", err.message);
    return sendError(res, 500, "Internal server error.");
  }
};

module.exports = {
  validateAppointmentIdParam,
  validateOrderIdParam,
  validateCreateAppointmentBody,
  validateUpdateAppointmentBody,
};
