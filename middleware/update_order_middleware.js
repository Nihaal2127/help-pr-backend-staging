const Offer = require("../models/offer");
const { checkObjectIdExists } = require("../validator/id_validator");
const { fieldLabel } = require("../utils/field_labels");

const isOfferClearValue = (value) =>
  value === null ||
  value === false ||
  (typeof value === "string" && value.trim() === "");

const updateOrderMiddleware = async (req, res, next) => {
  const { total_service_charge, service_price, offer_id } = req.body;

  if (total_service_charge !== undefined && total_service_charge !== null) {
    const n = Number(total_service_charge);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Total service charge must be greater than 0.",
      });
    }
  }

  if (service_price !== undefined && service_price !== null) {
    const n = Number(service_price);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: "Service price must be greater than 0.",
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "offer_id") && !isOfferClearValue(offer_id)) {
    const offerResult = await checkObjectIdExists(Offer, offer_id, "offer");
    if (offerResult.exists === false) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: offerResult.message,
      });
    }
  }

  next();
};

module.exports = { updateOrderMiddleware };
