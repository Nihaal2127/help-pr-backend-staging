const { isArray } = require("../validator/array_validator");
const { validateObjectId } = require("../validator/form_validator");
const { handleImageUpload } = require("../helper/image_uploader");
const { getUploadType } = require("../enum/upload_type_enum");
const { uploadImages } = require("../utils/fileUpload");

const isMultipart = (req) =>
  (req.headers["content-type"] || "").toLowerCase().includes("multipart/form-data");

const parseIdArrayField = (val) => {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    const s = val.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const p = JSON.parse(s);
        return Array.isArray(p) ? p : [];
      } catch (_) {
        return [];
      }
    }
    return s.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
};

const mapDescriptionToDesc = (body) => {
  if (
    (body.desc === undefined ||
      body.desc === null ||
      String(body.desc).trim() === "") &&
    body.description !== undefined &&
    body.description !== null
  ) {
    body.desc = body.description;
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    delete body.description;
  }
};

const mapCategoryToCategoryId = (body) => {
  if (
    (body.category_id === undefined ||
      body.category_id === null ||
      String(body.category_id).trim() === "") &&
    body.category !== undefined &&
    body.category !== null &&
    String(body.category).trim() !== ""
  ) {
    body.category_id = body.category;
  }
};

const parseBodyBool = (value, defaultValue) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return defaultValue;
};

const isValidNonNegativeNumber = (value) => {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return false;
  return parsed >= 0;
};

const stripLegacyServicePricingFields = (body) => {
  if (!body || typeof body !== "object") return;
  delete body.price;
  delete body.helpers;
};

const prepareServiceCreateBody = async (req, res, next) => {
  try {
    mapCategoryToCategoryId(req.body);
    mapDescriptionToDesc(req.body);
    stripLegacyServicePricingFields(req.body);
    if (isMultipart(req)) {
      if (req.file) {
        req.body.image_url = await handleImageUpload(
          req.file,
          getUploadType(3),
          true,
          null
        );
      }
      req.body.city_ids = parseIdArrayField(req.body.city_ids);
      req.body.state_ids = parseIdArrayField(req.body.state_ids);
    } else {
      if (req.body.city_ids != null && !Array.isArray(req.body.city_ids)) {
        req.body.city_ids = parseIdArrayField(req.body.city_ids);
      }
      if (req.body.state_ids != null && !Array.isArray(req.body.state_ids)) {
        req.body.state_ids = parseIdArrayField(req.body.state_ids);
      }
    }
    next();
  } catch (err) {
    console.error("prepareServiceCreateBody:", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || "Image upload failed.",
    });
  }
};

const prepareServiceUpdateBody = async (req, res, next) => {
  try {
    mapCategoryToCategoryId(req.body);
    mapDescriptionToDesc(req.body);
    stripLegacyServicePricingFields(req.body);
    if (isMultipart(req)) {
      if (req.file) {
        req.body.image_url = await handleImageUpload(
          req.file,
          getUploadType(3),
          true,
          null
        );
      }
      if (req.body.city_ids !== undefined) {
        req.body.city_ids = parseIdArrayField(req.body.city_ids);
      }
      if (req.body.state_ids !== undefined) {
        req.body.state_ids = parseIdArrayField(req.body.state_ids);
      }
    } else {
      if (req.body.city_ids != null && !Array.isArray(req.body.city_ids)) {
        req.body.city_ids = parseIdArrayField(req.body.city_ids);
      }
      if (req.body.state_ids != null && !Array.isArray(req.body.state_ids)) {
        req.body.state_ids = parseIdArrayField(req.body.state_ids);
      }
    }
    next();
  } catch (err) {
    console.error("prepareServiceUpdateBody:", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || "Image upload failed.",
    });
  }
};

const serviceImageUpload = (req, res, next) => {
  uploadImages.fields([
    { name: "image", maxCount: 1 },
    { name: "service_image", maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: err.message || "File upload error.",
      });
    }
    const files = req.files;
    const file = files?.image?.[0] || files?.service_image?.[0];
    if (file) req.file = file;
    next();
  });
};

const serviceCreateParser = (req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    return serviceImageUpload(req, res, next);
  }
  next();
};

const serviceUpdateParser = (req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    return serviceImageUpload(req, res, next);
  }
  next();
};

const createServiceMiddleware = (req, res, next) => {
  const {
    name,
    desc,
    tax,
    commission,
    payment_type,
    minimum_deposit,
    city_ids,
    state_ids,
    image_url,
    is_active,
  } = req.body;

  const isRequest = parseBodyBool(req.body.is_request, false);

  if (!name || String(name).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Service name is required.",
    });
  }
  if (!desc || String(desc).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Service description is required.",
    });
  }
  if (!image_url || String(image_url).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Service Image is required.",
    });
  }

  if (isRequest) {
    return next();
  }

  if (tax === undefined || tax === null || String(tax).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Tax is required.",
    });
  }
  if (!isValidNonNegativeNumber(tax)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Tax must be a valid non-negative number.",
    });
  }
  if (commission === undefined || commission === null || String(commission).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Commission is required.",
    });
  }
  if (!isValidNonNegativeNumber(commission)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Commission must be a valid non-negative number.",
    });
  }
  if (
    payment_type === undefined ||
    payment_type === null ||
    String(payment_type).trim() === ""
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Payment type is required.",
    });
  }
  if (
    minimum_deposit === undefined ||
    minimum_deposit === null ||
    String(minimum_deposit).trim() === ""
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Minimum deposit is required.",
    });
  }
  if (!isValidNonNegativeNumber(minimum_deposit)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Minimum deposit must be a valid non-negative number.",
    });
  }
  if (is_active === undefined) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Status is required",
    });
  }
  next();
};

const createServiceRequestMiddleware = (req, res, next) => {
  const { name, desc, image_url, category_id, tax, commission, payment_type, minimum_deposit } = req.body;
  if (!name || String(name).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Service name is required.",
    });
  }
  if (!desc || String(desc).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Service description is required.",
    });
  }
  if (!image_url || String(image_url).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Service Image is required.",
    });
  }
  if (category_id === undefined || category_id === null || String(category_id).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category id is required.",
    });
  }
  if (tax === undefined || tax === null || String(tax).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Tax is required.",
    });
  }
  if (!isValidNonNegativeNumber(tax)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Tax must be a valid non-negative number.",
    });
  }
  if (commission === undefined || commission === null || String(commission).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Commission is required.",
    });
  }
  if (!isValidNonNegativeNumber(commission)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Commission must be a valid non-negative number.",
    });
  }
  if (
    payment_type === undefined ||
    payment_type === null ||
    String(payment_type).trim() === ""
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Payment type is required.",
    });
  }
  if (
    minimum_deposit === undefined ||
    minimum_deposit === null ||
    String(minimum_deposit).trim() === ""
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Minimum deposit is required.",
    });
  }
  if (!isValidNonNegativeNumber(minimum_deposit)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Minimum deposit must be a valid non-negative number.",
    });
  }
  req.body.is_request = true;
  next();
};

const updateServiceRequestMiddleware = (req, res, next) =>
  createServiceRequestMiddleware(req, res, next);

const updateServiceMiddleware = (req, res, next) => {
  const {
    name,
    desc,
    tax,
    commission,
    payment_type,
    minimum_deposit,
    category_id,
    image_url,
  } = req.body;

  if (name !== undefined && String(name).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Service name is required.",
    });
  }
  if (desc !== undefined && String(desc).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Service description is required.",
    });
  }
  if (
    tax !== undefined &&
    (tax === null || String(tax).trim() === "" || !isValidNonNegativeNumber(tax))
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Tax must be a valid non-negative number.",
    });
  }
  if (
    commission !== undefined &&
    (commission === null ||
      String(commission).trim() === "" ||
      !isValidNonNegativeNumber(commission))
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Commission must be a valid non-negative number.",
    });
  }
  if (
    payment_type !== undefined &&
    (payment_type === null || String(payment_type).trim() === "")
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Payment type is required.",
    });
  }
  if (
    minimum_deposit !== undefined &&
    (minimum_deposit === null ||
      String(minimum_deposit).trim() === "" ||
      !isValidNonNegativeNumber(minimum_deposit))
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Minimum deposit must be a valid non-negative number.",
    });
  }
  const catValidationData = validateObjectId(category_id, "Category");
  if (category_id !== undefined && catValidationData.valid === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: catValidationData.message,
    });
  }
  if (image_url !== undefined && String(image_url).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Service Image is required.",
    });
  }
  next();
};

module.exports = {
  serviceCreateParser,
  serviceUpdateParser,
  createServiceMiddleware,
  createServiceRequestMiddleware,
  updateServiceRequestMiddleware,
  updateServiceMiddleware,
  prepareServiceCreateBody,
  prepareServiceUpdateBody,
};
