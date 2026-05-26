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

const resolveRawServiceInput = (body) => {
  if (body.service_ids !== undefined && body.service_ids !== null) {
    return body.service_ids;
  }
  if (
    Object.prototype.hasOwnProperty.call(body, "service_ids[]") &&
    body["service_ids[]"] !== undefined &&
    body["service_ids[]"] !== null
  ) {
    return body["service_ids[]"];
  }
  if (body.services !== undefined && body.services !== null) {
    return body.services;
  }
  return undefined;
};

const parseServiceIdsField = (body) => {
  const raw = resolveRawServiceInput(body);
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    if (
      raw.length > 0 &&
      typeof raw[0] === "object" &&
      raw[0] !== null &&
      Object.prototype.hasOwnProperty.call(raw[0], "_id")
    ) {
      return raw
        .map((x) =>
          x && x._id != null ? String(x._id).trim() : ""
        )
        .filter(Boolean);
    }
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        return Array.isArray(parsed)
          ? parsed.map((x) => String(x).trim()).filter(Boolean)
          : [];
      } catch (_) {
        return [];
      }
    }
    return s.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [String(raw)];
};

const prepareCategoryCreateBody = async (req, res, next) => {
  try {
    mapDescriptionToDesc(req.body);
    if (isMultipart(req)) {
      if (req.file) {
        req.body.image_url = await handleImageUpload(
          req.file,
          getUploadType(2),
          true,
          null
        );
      }
      req.body.service_ids = parseServiceIdsField(req.body);
      req.body.city_ids = parseIdArrayField(req.body.city_ids);
      req.body.state_ids = parseIdArrayField(req.body.state_ids);
    } else {
      if (req.body.service_ids == null || !Array.isArray(req.body.service_ids)) {
        req.body.service_ids = parseServiceIdsField(req.body);
      }
      if (req.body.city_ids != null && !Array.isArray(req.body.city_ids)) {
        req.body.city_ids = parseIdArrayField(req.body.city_ids);
      }
      if (req.body.state_ids != null && !Array.isArray(req.body.state_ids)) {
        req.body.state_ids = parseIdArrayField(req.body.state_ids);
      }
    }
    next();
  } catch (err) {
    console.error("prepareCategoryCreateBody:", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || "Image upload failed.",
    });
  }
};

const prepareCategoryUpdateBody = async (req, res, next) => {
  try {
    mapDescriptionToDesc(req.body);
    const hasServiceIdsField = resolveRawServiceInput(req.body) !== undefined;
    if (isMultipart(req)) {
      if (req.file) {
        req.body.image_url = await handleImageUpload(
          req.file,
          getUploadType(2),
          true,
          null
        );
      }
      if (hasServiceIdsField) {
        req.body.service_ids = parseServiceIdsField(req.body);
      }
      req.body.city_ids = parseIdArrayField(req.body.city_ids);
      req.body.state_ids = parseIdArrayField(req.body.state_ids);
    } else {
      if (hasServiceIdsField) {
        if (req.body.service_ids == null || !Array.isArray(req.body.service_ids)) {
          req.body.service_ids = parseServiceIdsField(req.body);
        }
      }
      if (req.body.city_ids != null && !Array.isArray(req.body.city_ids)) {
        req.body.city_ids = parseIdArrayField(req.body.city_ids);
      }
      if (req.body.state_ids != null && !Array.isArray(req.body.state_ids)) {
        req.body.state_ids = parseIdArrayField(req.body.state_ids);
      }
    }
    next();
  } catch (err) {
    console.error("prepareCategoryUpdateBody:", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || "Image upload failed.",
    });
  }
};

const categoryImageUpload = (req, res, next) => {
  uploadImages.single("image")(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: err.message || "File upload error.",
      });
    }
    next();
  });
};

const categoryCreateParser = (req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    return categoryImageUpload(req, res, next);
  }
  next();
};

const categoryUpdateParser = (req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    return categoryImageUpload(req, res, next);
  }
  next();
};

const createCategoryMiddleware = (req, res, next) => {
  const {
    name,
    desc,
    image_url,
  } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category name is required.",
    });
  }
  if (!desc || desc.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category description is required.",
    });
  }
  if (!image_url || image_url.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category Image is required.",
    });
  }
  next();
};

const createCategoryRequestMiddleware = (req, res, next) => {
  const { name, desc, image_url } = req.body;
  if (!name || String(name).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category name is required.",
    });
  }
  if (!desc || String(desc).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category description is required.",
    });
  }
  if (!image_url || String(image_url).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category Image is required.",
    });
  }
  req.body.is_request = true;
  next();
};

const updateCategoryRequestMiddleware = (req, res, next) =>
  createCategoryRequestMiddleware(req, res, next);

const updateCategoryRoleMiddleware = (req, res, next) => {
  next();
};

const updateCategoryMiddleware = (req, res, next) => {
  const {
    name,
    desc,
    image_url,
    service_ids,
  } = req.body;

  if (name !== undefined && name.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category name is required.",
    });
  }
  if (desc !== undefined && desc.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category description is required.",
    });
  }
  if (image_url !== undefined && image_url.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category Image is required.",
    });
  }
  if (service_ids !== undefined) {
    if (!Array.isArray(service_ids)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Service ids must be an array.",
      });
    }
    if (
      service_ids.length > 0 &&
      !service_ids.every(
        (id) => id !== undefined && id !== null && String(id).trim() !== ""
      )
    ) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Each service id must be a non-empty value.",
      });
    }
  }
  next();
};
module.exports = {
  categoryCreateParser,
  categoryUpdateParser,
  createCategoryMiddleware,
  createCategoryRequestMiddleware,
  updateCategoryRequestMiddleware,
  updateCategoryMiddleware,
  updateCategoryRoleMiddleware,
  prepareCategoryCreateBody,
  prepareCategoryUpdateBody,
};
