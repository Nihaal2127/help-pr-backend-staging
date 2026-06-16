const mongoose = require("mongoose");
const { isMongoObjectIdHex } = require("../../../utils/mongoose_helpers");

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    status,
    message,
  });

const validateAppointmentIdParam = (req, res, next) => {
  try {
    const id = String(req.params.appointmentId ?? "").trim();
    if (!id) {
      return sendError(res, 400, "appointmentId is required.");
    }
    if (isMongoObjectIdHex(id)) {
      return next();
    }
    if (/^AP\d+$/i.test(id)) {
      return next();
    }
    return sendError(res, 400, "Invalid appointment id.");
  } catch (err) {
    console.error("validateAppointmentIdParam (partner):", err.message);
    return sendError(res, 500, "Internal server error.");
  }
};

const validateOrderIdParam = (req, res, next) => {
  try {
    const id = String(req.params.orderId ?? "").trim();
    if (!id) {
      return sendError(res, 400, "orderId is required.");
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid order id.");
    }
    next();
  } catch (err) {
    console.error("validateOrderIdParam (partner appointment):", err.message);
    return sendError(res, 500, "Internal server error.");
  }
};

module.exports = {
  validateAppointmentIdParam,
  validateOrderIdParam,
};
