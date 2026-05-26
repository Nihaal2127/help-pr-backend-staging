const mongoose = require("mongoose");
const Category = require('../models/category');
const User = require('../models/user');
const City = require('../models/city');
const State = require('../models/state');
const Service = require('../models/service');
const franchiseCategoryService = require('../services/franchise_category_service');
const { applyCatalogRequestScopeForCaller } = require('../utils/franchise_catalog_request_scope');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { validationResult } = require('express-validator');
const { parseBoolean } = require('../utils/parser');
const { checkObjectIdExists } = require('../validator/id_validator');
const { getCategoryId } = require('../helper/id_generator');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const {
  USER_TYPE_ADMIN,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
} = require('../middleware/role_middleware');
const {
  isGlobalCatalogRowActive,
  onGlobalCategoryDeactivated,
} = require('../services/catalog_cascade_service');
const {
  normalizeCatalogName,
  categoryNameExistsQuery,
  findExistingCatalogNames,
  importFileDuplicateNamesMessage,
} = require('../utils/catalog_name_uniqueness');

const asBodyBool = (value, defaultValue) => {
  if (value === undefined) return defaultValue;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return defaultValue;
};

const asRejectedState = (value, defaultValue = null) => {
  if (value === undefined) return defaultValue;
  if (value === null || value === "null" || value === "") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return defaultValue;
};

const asApprovalStatus = (value, defaultValue = "approve") => {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "approved") return "approve";
  if (["approve", "pending", "rejected"].includes(normalized)) return normalized;
  return defaultValue;
};


const dedupeServiceIds = (ids) => {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const s = String(id);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(id);
    }
  }
  return out;
};

const getIdValidationStatus = (message = "") => {
  if (message.includes("Invalid")) return 400;
  if (message.includes("not found")) return 404;
  return 400;
};

const getCategoryStatusConfig = (statusFilter = "") => {
  const value = String(statusFilter || "").trim().toLowerCase();
  if (value === "active") return { is_active: true, is_request: false };
  if (value === "inactive") return { is_active: false, is_request: false };
  if (value === "requested" || value === "requested_categories") return { is_request: true };
  return {};
};

/** Query: sort_by = name | category_name | created_at | services; sort_order | order = asc | desc. Legacy: sort=1|-1 on created_at when sort_by omitted. */
const parseCategoryGetAllSort = (query) => {
  const orderRaw = String(
    query.sort_order ?? query.sortOrder ?? query.order ?? ""
  )
    .trim()
    .toLowerCase();

  const resolveDirection = (defaultWhenMissing = 1) => {
    if (orderRaw === "asc" || orderRaw === "1") return 1;
    if (orderRaw === "desc" || orderRaw === "-1") return -1;
    const legacy = query.sort !== undefined ? parseInt(query.sort, 10) : NaN;
    if (legacy === 1 || legacy === -1) return legacy;
    return defaultWhenMissing;
  };

  const sortByRaw = query.sort_by;
  if (
    sortByRaw === undefined ||
    sortByRaw === null ||
    String(sortByRaw).trim() === ""
  ) {
    const sortOrder = resolveDirection(1);
    return { sortBy: "created_at", sortOrder, mongoSort: { created_at: sortOrder } };
  }

  const sortBy = String(sortByRaw).trim().toLowerCase().replace(/-/g, "_");
  const sortOrder = resolveDirection(1);

  if (sortBy === "services") {
    return { sortBy: "services", sortOrder, mongoSort: null };
  }

  const mongoField =
    sortBy === "name" || sortBy === "category_name"
      ? "name"
      : sortBy === "created_at"
        ? "created_at"
        : "created_at";

  return {
    sortBy: mongoField,
    sortOrder,
    mongoSort: { [mongoField]: sortOrder },
  };
};

const sendFranchiseCategoryResult = (res, result) => {
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      status: result.status,
      message: result.message,
      ...(result.error !== undefined && { error: result.error }),
    });
  }
  return res.status(result.status).json({
    success: true,
    status: result.status,
    ...result.data,
  });
};

const attachRequestedByUser = async (records) => {
  if (!Array.isArray(records) || records.length === 0) return records;

  const requestedByIds = [
    ...new Set(
      records
        .map((record) => record?.requested_by)
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => String(id))
    ),
  ];

  if (requestedByIds.length === 0) return records;

  const users = await User.find({
    _id: { $in: requestedByIds },
    deleted_at: null,
  }).select("name");

  const userMap = new Map(users.map((user) => [String(user._id), user]));

  return records.map((record) => {
    const plainRecord =
      record && typeof record.toObject === "function" ? record.toObject() : record;
    const requestedById = plainRecord?.requested_by
      ? String(plainRecord.requested_by)
      : null;
    const requestedByUser = requestedById ? userMap.get(requestedById) : null;
    return {
      ...plainRecord,
      requested_by:
        requestedById && requestedByUser
          ? {
            id: String(requestedByUser._id),
            name: requestedByUser.name || null,
          }
          : plainRecord.requested_by,
    };
  });
};

const attachServiceNames = async (records) => {
  if (!Array.isArray(records) || records.length === 0) return records;

  const serviceIds = [
    ...new Set(
      records
        .flatMap((record) => (Array.isArray(record?.services) ? record.services : []))
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => String(id))
    ),
  ];

  if (serviceIds.length === 0) {
    return records.map((record) => {
      const plainRecord =
        record && typeof record.toObject === "function" ? record.toObject() : record;
      return { ...plainRecord, services: [] };
    });
  }

  const services = await Service.find({
    _id: { $in: serviceIds },
    deleted_at: null,
  }).select("name");

  const serviceMap = new Map(services.map((service) => [String(service._id), service.name]));

  return records.map((record) => {
    const plainRecord =
      record && typeof record.toObject === "function" ? record.toObject() : record;
    const servicesWithNames = (Array.isArray(plainRecord.services) ? plainRecord.services : [])
      .map((id) => ({
        _id: String(id),
        name: serviceMap.get(String(id)) || null,
      }));
    return { ...plainRecord, services: servicesWithNames };
  });
};

const getAll = async (req, res) => {

  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: "Unauthorized",
      });
    }

    if (req.params.franchise_id) {
      const result = await franchiseCategoryService.list(
        { ...req.query, franchise_id: req.params.franchise_id },
        req.user.id
      );
      return sendFranchiseCategoryResult(res, result);
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const statusFilter =
      req.query.status !== undefined && req.query.status !== null
        ? String(req.query.status).trim().toLowerCase()
        : "";
    // const type = parseInt(req.query.type);
    const is_active = req.query.is_active !== undefined ? parseBoolean(req.query.is_active) : null;

    // const callout_price = req.query.callout_price !== undefined ? parseFloat(req.query.callout_price) : null;
    // const fitting_price = req.query.fitting_price !== undefined ? parseFloat(req.query.fitting_price) : null;
    // const store_price = req.query.store_price !== undefined ? parseFloat(req.query.store_price) : null;
    // const delivery_price = req.query.delivery_price !== undefined ? parseFloat(req.query.delivery_price) : null;


    // const filter = {
    //   deleted_at: null,
    //   ...(req.query.type && { type: type }),
    //   ...(req.query.callout_price && { callout_price: callout_price }),
    //   ...(req.query.fitting_price && { fitting_price: fitting_price }),
    //   ...(req.query.store_price && { store_price: store_price }),
    //   ...(req.query.delivery_price && { delivery_price: delivery_price }),

    //   ...(req.query.is_active && { is_active: is_active }),
    // };
    // if (req.query.name) {
    //   filter.name = { $regex: new RegExp(req.query.name, "i") }; // Case-insensitive match
    // }
    // if (req.query.state_name) {
    //   filter.state_name = { $regex: new RegExp(req.query.state_name, "i") }; // Case-insensitive match
    // }
    // if (req.query.state_id) {
    //   if (mongoose.Types.ObjectId.isValid(req.query.state_id)) {
    //     filter.state_ids = { $in: [new mongoose.Types.ObjectId(req.query.state_id)] };
    //   } else {
    //     return res.status(400).json({
    //       success: false,
    //       status: 400,
    //       message: "Invalid state id format.",
    //     });
    //   }
    // }
    // if (req.query.city_id) {
    //   if (mongoose.Types.ObjectId.isValid(req.query.city_id)) {
    //     filter.city_ids = { $in: [new mongoose.Types.ObjectId(req.query.city_id)] };
    //   } else {
    //     return res.status(400).json({
    //       success: false,
    //       status: 400,
    //       message: "Invalid City id format.",
    //     });
    //   }
    // }


    const keyword = req.query.search !== undefined ? req.query.search : req.query.keyword;
    let regex;
    let serviceIdsFromKeyword = [];
    if (keyword) {
      const sanitizedKeyword = sanitizeInput(keyword);
      regex = new RegExp(sanitizedKeyword, 'i'); // Case-insensitive regex search
      const matchedServices = await Service.find({
        deleted_at: null,
        name: regex,
      }).select('_id');
      serviceIdsFromKeyword = matchedServices.map((service) => service._id);
    }
    let categoryNameRegex;
    if (req.query.category_name) {
      const sanitizedCategoryName = sanitizeInput(req.query.category_name);
      categoryNameRegex = new RegExp(sanitizedCategoryName, 'i');
    }
    let servicesRegex;
    let serviceIdsFromServiceSearch = [];
    if (req.query.services) {
      const sanitizedServicesKeyword = sanitizeInput(req.query.services);
      servicesRegex = new RegExp(sanitizedServicesKeyword, 'i');
      const matchedServices = await Service.find({
        deleted_at: null,
        name: servicesRegex,
      }).select('_id');
      serviceIdsFromServiceSearch = matchedServices.map((service) => service._id);
    }
    const is_request =
      req.query.is_request !== undefined ? parseBoolean(req.query.is_request) : null;
    const approval_status =
      req.query.approval_status !== undefined && req.query.approval_status !== null
        ? String(req.query.approval_status).trim().toLowerCase()
        : "";

    let filter = {
      deleted_at: null,
      // ...(req.query.type && { type: type }),
      ...(is_active !== null && { is_active }),
      ...(is_request !== null && { is_request }),
      ...(approval_status && { approval_status }),
      ...(keyword && {
        $or: [
          { name: regex },
          { desc: regex },
          ...(serviceIdsFromKeyword.length > 0 ? [{ services: { $in: serviceIdsFromKeyword } }] : []),
        ]
      }),
      ...(req.query.category_name && { name: categoryNameRegex }),
      ...(req.query.services && { services: { $in: serviceIdsFromServiceSearch } }),
    };
    const statusConfig = getCategoryStatusConfig(statusFilter);
    Object.assign(filter, statusConfig);
    if (req.query.city_id) {
      const cityResult = await checkObjectIdExists(City, req.query.city_id, 'city');
      if (cityResult.exists) {
        filter.city_ids = { $in: [new mongoose.Types.ObjectId(req.query.city_id)] };
      } else {
        return res.status(400).json({
          success: false,
          status: 400,
          message: cityResult.message,
        });
      }
    }

    const caller = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type franchise_id');
    if (!caller) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'User not found.',
      });
    }
    const isRequestListing =
      filter.is_request === true || statusConfig.is_request === true;
    const scopeResult = await applyCatalogRequestScopeForCaller(
      filter,
      caller,
      req.query,
      isRequestListing
    );
    if (!scopeResult.ok) {
      return res.status(scopeResult.status).json({
        success: false,
        status: scopeResult.status,
        message: scopeResult.message,
      });
    }

    // Align with POST /api/getCount type 2 (service-management) global totals:
    // total_category counts only is_request: false unless the client filters explicitly.
    if (
      (caller.type === USER_TYPE_SUPER_ADMIN || caller.type === USER_TYPE_STAFF) &&
      is_request === null &&
      filter.is_request === undefined
    ) {
      filter.is_request = false;
    }

    const { sortBy, sortOrder, mongoSort } = parseCategoryGetAllSort(req.query);

    let categories = [];
    let totalCount = 0;
    let totalPages = 0;
    let currentPage = page;

    if (sortBy === 'services') {
      const skip = (page - 1) * limit;
      const result = await Category.aggregate([
        { $match: filter },
        { $addFields: { services_count: { $size: { $ifNull: ['$services', []] } } } },
        { $sort: { services_count: sortOrder } },
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }],
            totalCount: [{ $count: 'totalCount' }],
          },
        },
      ]);
      categories = result[0].data;
      totalCount = result[0].totalCount.length > 0 ? result[0].totalCount[0].totalCount : 0;
      totalPages = Math.ceil(totalCount / limit);
    } else {
      const pageResult = await applyPagination(
        Category,
        filter,
        page,
        limit,
        mongoSort
      );
      categories = pageResult.data;
      totalCount = pageResult.totalCount;
      totalPages = pageResult.totalPages;
      currentPage = pageResult.currentPage;
    }

    const requestedByEnrichedCategories = await attachRequestedByUser(categories);
    const enrichedCategories = await attachServiceNames(requestedByEnrichedCategories);

    res.status(200).json({
      success: true,
      status: 200,
      message: "Category list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: enrichedCategories,
    });
  } catch (err) {
    console.log("Error is ", err.message);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};
const create = async (req, res) => {
  try {
    const {
      name,
      desc,
      city_ids = [],
      state_ids = [],
      image_url,
      service_ids: rawServiceIds = [],
      rejection_reason,
    } = req.body;
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);
    const service_ids = dedupeServiceIds(rawServiceIds);

    const trimmedName = normalizeCatalogName(name);
    const existingCategory = await Category.findOne(categoryNameExistsQuery(trimmedName));

    if (existingCategory) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'Category name already exists.',
      });
    }

    if (state_ids.length > 0) {
      const stateResult = await checkObjectIdExists(State, state_ids, 'state');
      if (stateResult.exists === false) {
        const statusCode = getIdValidationStatus(stateResult.message);
        return res.status(statusCode).json({
          success: false,
          status: statusCode,
          message: stateResult.message,
        });
      }
    }

    if (city_ids.length > 0) {
      const cityResult = await checkObjectIdExists(City, city_ids, 'city');
      if (cityResult.exists === false) {
        const statusCode = getIdValidationStatus(cityResult.message);
        return res.status(statusCode).json({
          success: false,
          status: statusCode,
          message: cityResult.message,
        });
      }
    }

    const category_id = await getCategoryId();
    const services = dedupeServiceIds(service_ids);
    const newCategory = new Category({
      name: trimmedName,
      desc,
      category_id,
      city_ids,
      state_ids,
      services,
      image_url,
      is_active: asBodyBool(req.body.is_active, false),
      is_request: asBodyBool(req.body.is_request, false),
      approval_status: asBodyBool(req.body.is_request, false) ? "pending" : "approve",
      rejection_reason: null,
      requested_by: asBodyBool(req.body.is_request, false) ? req.user.id : null,
    });

    const savedCategory = await newCategory.save();
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Category created successfully.',
      record: savedCategory,
    });
  } catch (error) {
    console.error('Error creating Category:', error.message);
    if (error?.name === 'CastError') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid id format.',
      });
    }
    if (error?.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: error.message || 'Invalid input.',
      });
    }
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const update = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const updateData = req.body;

  try {

    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    const wasGloballyActive = isGlobalCatalogRowActive(category);

    if (req.body.name) {
      const trimmedName = normalizeCatalogName(req.body.name);
      const existingCategory = await Category.findOne(
        categoryNameExistsQuery(trimmedName, id)
      );

      if (existingCategory) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: 'Category name already exists.',
        });
      }
      updateData.name = trimmedName;
    }
    if (req.body.state_ids) {

      const stateResult = await checkObjectIdExists(State, req.body.state_ids, 'state');
      if (stateResult.exists === false) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: stateResult.message,
        });
      }
    }
    if (req.body.city_ids) {

      const cityResult = await checkObjectIdExists(City, req.body.city_ids, 'category');
      if (cityResult.exists === false) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: cityResult.message,
        });
      }
    }

    let builtServices;
    if (req.body.service_ids !== undefined) {
      const uniqueIds = dedupeServiceIds(req.body.service_ids);
      if (uniqueIds.length > 0) {
        const serviceResult = await checkObjectIdExists(Service, uniqueIds, 'service');
        if (serviceResult.exists === false) {
          return res.status(409).json({
            success: false,
            status: 409,
            message: serviceResult.message,
          });
        }
        builtServices = dedupeServiceIds(uniqueIds);
      }
    }

    if (builtServices !== undefined) {
      category.services = builtServices;
      delete updateData.services;
    }

    delete updateData.requested_by;
    delete updateData.service_ids;

    if (updateData.approval_status !== undefined) {
      updateData.approval_status = asApprovalStatus(updateData.approval_status, category.approval_status);
    }
    if (updateData.is_rejected !== undefined) {
      const nextRejectedState = asBodyBool(updateData.is_rejected, null);
      if (nextRejectedState === true) updateData.approval_status = "rejected";
      else if (nextRejectedState === false) updateData.approval_status = "approve";
      delete updateData.is_rejected;
    }

    if (updateData.approval_status !== undefined) {
      if (updateData.approval_status === "rejected") {
        const reason = updateData.rejection_reason;
        if (reason === undefined || reason === null || String(reason).trim() === "") {
          return res.status(400).json({
            success: false,
            status: 400,
            message: "Rejection reason is required when rejecting.",
          });
        }
        updateData.is_request = true;
        updateData.rejection_reason = String(reason).trim();
      } else if (updateData.approval_status === "approve") {
        updateData.is_request = false;
        updateData.rejection_reason = null;
      } else if (updateData.approval_status === "pending") {
        updateData.is_request = true;
        updateData.rejection_reason = null;
      }
    } else if (updateData.rejection_reason !== undefined) {
      updateData.rejection_reason = category.approval_status === "rejected"
        ? (updateData.rejection_reason === undefined ||
          updateData.rejection_reason === null ||
          updateData.rejection_reason === ""
          ? null
          : String(updateData.rejection_reason))
        : null;
    }

    Object.keys(updateData).forEach((key) => {
      if (key === "is_active") {
        category[key] = asBodyBool(updateData[key], category[key]);
        return;
      }
      if (key === "is_request") {
        category[key] = asBodyBool(updateData[key], category[key]);
        return;
      }
      if (key === "rejection_reason") {
        const v = updateData[key];
        category[key] =
          v === undefined || v === null || v === "" ? null : String(v);
        return;
      }
      category[key] = updateData[key];
    });

    category.updated_at = Date.now();
    const updatedCategory = await category.save();

    if (wasGloballyActive && updatedCategory.is_active === false) {
      try {
        await onGlobalCategoryDeactivated(updatedCategory._id);
      } catch (cascadeErr) {
        console.error('category update cascade failed:', cascadeErr.message);
      }
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Category updated successfully',
      record: updatedCategory,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const getById = async (req, res) => {
  const { id } = req.params;

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid category id.',
      });
    }

    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    const [requestedByEnrichedCategory] = await attachRequestedByUser([category]);
    const [enrichedCategory] = await attachServiceNames([requestedByEnrichedCategory]);

    res.status(200).json({
      success: true,
      status: 201,
      message: 'Category fetched successfully',
      record: enrichedCategory,
    });
  } catch (error) {
    console.error('Error fetching Category:', error);
    if (error?.name === 'CastError') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid id format.',
      });
    }
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const deleteCategory = async (req, res) => {
  const { id } = req.params;

  try {

    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }


    if (category.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Category is already deleted'
      });
    }


    if (isGlobalCatalogRowActive(category)) {
      try {
        await onGlobalCategoryDeactivated(category._id);
      } catch (cascadeErr) {
        console.error('category delete cascade failed:', cascadeErr.message);
      }
    }

    category.deleted_at = new Date();
    category.updated_at = Date.now();

    await category.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Category deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Category:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const importRecords = async (req, res) => {
  try {
    const records = req.body.records;

    if (!records || !Array.isArray(records)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid input. Expected an array of records.'
      });
    }

    if (records.length === 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Please add records in excel sheet.'
      });
    }


    const normalizedRows = records.map((record) => ({
      ...record,
      name: normalizeCatalogName(record.name),
    }));
    for (const r of normalizedRows) {
      if (!r.name) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Each record must include a non-empty category name.',
        });
      }
    }
    const importDupMsg = importFileDuplicateNamesMessage(
      normalizedRows.map((r) => r.name),
      'category'
    );
    if (importDupMsg) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: importDupMsg,
      });
    }
    const existingRecords = await findExistingCatalogNames(
      Category,
      normalizedRows.map((r) => r.name)
    );

    if (existingRecords.length > 0) {
      const duplicateNames = existingRecords.map(record => record.name).join('\n');
      return res.status(409).json({
        success: false,
        status: 409,
        message: `Duplicate records found. No records were added.\nDuplicate records:\n${duplicateNames}`
      });
    }

    const stateNames = [...new Set(records.map(record => record.state_name))];
    const states = await State.find({
      name: { $in: stateNames.map(state => new RegExp(`^${state}$`, 'i')) },
      deleted_at: null
    }).select('_id name');

    const stateMap = new Map(states.map(state => [state.name, { _id: state._id }]));
    const enrichedRecords = [];
    const missingStates = new Set();

    for (const record of normalizedRows) {
      const state = stateMap.get(record.state_name);
      if (state) {
        enrichedRecords.push({
          ...record,
          state_id: state._id,
        });
      } else {
        missingStates.add(record.state_name);
      }
    }
    if (missingStates.size > 0) {
      const missingStateNames = Array.from(missingStates).join('\n');
      return res.status(400).json({
        success: false,
        status: 400,
        message: `Below states were not found.\n${missingStateNames}`,
      });
    }
    const result = await Category.insertMany(enrichedRecords, { ordered: false });

    res.status(200).json({
      success: true,
      status: 200,
      message: `${result.length} records added successfully!`,
      records: result
    });
  } catch (error) {
    console.log("Error is ", error.message);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: error.message
    });
  }
};
const getDropDown = async (req, res) => {

  try {

    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };

    if (req.query.city_id) {

      const cityResult = await checkObjectIdExists(City, req.query.city_id, 'city');
      if (cityResult.exists === false) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: cityResult.message,
        });
      }
      const cityId = new mongoose.Types.ObjectId(req.query.city_id);
      filter.city_ids = { $in: [cityId] };
    }

    const { data: categories, } = await applyDropDownFilter(
      Category,
      filter,
      sort
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: "Category list fetched successfully.",
      records: categories,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};
module.exports = { getAll, create, update, getById, deleteCategory, importRecords, getDropDown };