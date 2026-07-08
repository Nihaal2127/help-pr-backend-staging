const mongoose = require("mongoose");
const Service = require('../models/service');
const User = require('../models/user');
const Category = require('../models/category');
const City = require('../models/city');
const State = require('../models/state');
const franchiseServiceManagementService = require('../services/franchise_service_management_service');
const { applyCatalogRequestScopeForCaller } = require('../utils/franchise_catalog_request_scope');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { validationResult } = require('express-validator');
const { parseBoolean } = require('../utils/parser');
const { checkObjectIdExists } = require('../validator/id_validator');
const { getServiceId } = require('../helper/id_generator');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const {
  USER_TYPE_ADMIN,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
} = require('../middleware/role_middleware');
const {
  isGlobalCatalogRowActive,
  onGlobalServiceDeactivated,
  validateGlobalServiceActivation,
} = require('../services/catalog_cascade_service');
const {
  normalizeCatalogName,
  serviceNameExistsQuery,
  findExistingCatalogNames,
  importFileDuplicateNamesMessage,
} = require('../utils/catalog_name_uniqueness');
const {
  safeNotifyBackofficeServiceRequested,
  safeNotifyBackofficeCatalogReviewed,
} = require('../src/modules/notifications/services/backofficeHooks');

const asBodyBool = (value, defaultValue) => {
  if (value === undefined) return defaultValue;
  if (value === null || value === "null") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return defaultValue;
};

const asBodyNumber = (value, defaultValue = 0) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
};

const asApprovalStatus = (value, defaultValue = "approve") => {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["approve", "pending", "rejected"].includes(normalized)) return normalized;
  return defaultValue;
};

const normalizePaymentType = (value) => {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, "_");
  const paymentTypeMap = {
    per_hour: "per_hour",
    per_day: "per_day",
    per_month: "per_month",
    per_consultancy: "per_consultancy",
  };
  return paymentTypeMap[normalized] || normalized;
};

const getIdValidationStatus = (message = "") => {
  if (message.includes("Invalid")) return 400;
  if (message.includes("not found")) return 404;
  return 400;
};

const getServiceStatusConfig = (statusFilter = "") => {
  const value = String(statusFilter || "").trim().toLowerCase();
  if (value === "active") return { service: { is_active: true, is_request: false } };
  if (value === "inactive") return { service: { is_active: false, is_request: false } };
  if (value === "requested" || value === "requested_services") {
    return { service: { is_request: true } };
  }
  if (value === "active_category" || value === "active_categories") {
    return { category: { is_active: true, is_request: false } };
  }
  if (value === "inactive_category" || value === "inactive_categories") {
    return { category: { is_active: false, is_request: false } };
  }
  if (value === "requested_category" || value === "requested_categories") {
    return { category: { is_request: true } };
  }
  return {};
};

const sendFranchiseServiceResult = (res, result) => {
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

const stripServiceLocationFields = (serviceRecord) => {
  if (!serviceRecord || typeof serviceRecord !== "object") return serviceRecord;
  const plainRecord =
    serviceRecord && typeof serviceRecord.toObject === "function"
      ? serviceRecord.toObject()
      : { ...serviceRecord };
  delete plainRecord.city_ids;
  delete plainRecord.state_ids;
  delete plainRecord.price;
  delete plainRecord.helpers;
  if (Object.prototype.hasOwnProperty.call(plainRecord, "payment_type")) {
    plainRecord.payment_type = normalizePaymentType(plainRecord.payment_type);
  }
  return plainRecord;
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
      const result = await franchiseServiceManagementService.list(
        { ...req.query, franchise_id: req.params.franchise_id },
        req.user.id
      );
      return sendFranchiseServiceResult(res, result);
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const statusFilter =
      req.query.status !== undefined && req.query.status !== null
        ? String(req.query.status).trim().toLowerCase()
        : "";
    // const type = parseInt(req.query.type);
    const is_active = req.query.is_active !== undefined ? parseBoolean(req.query.is_active) : null;
    const is_request =
      req.query.is_request !== undefined ? parseBoolean(req.query.is_request) : null;
    const approval_status =
      req.query.approval_status !== undefined && req.query.approval_status !== null
        ? String(req.query.approval_status).trim().toLowerCase()
        : "";

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


    const filter = {
      deleted_at: null,
      ...(req.query.is_active !== undefined && { is_active }),
      ...(is_request !== null && { is_request }),
      ...(approval_status && { approval_status }),
    };
    const statusConfig = getServiceStatusConfig(statusFilter);
    if (statusConfig.service) {
      Object.assign(filter, statusConfig.service);
    }
    if (statusConfig.category) {
      const categoryIdsByStatus = await Category.find({
        deleted_at: null,
        ...statusConfig.category,
      }).distinct("_id");
      filter.category_id =
        categoryIdsByStatus.length > 0 ? { $in: categoryIdsByStatus } : { $in: [] };
    }

    const caller = await User.findOne({ _id: req.user.id, deleted_at: null }).select(
      'type franchise_id'
    );
    if (!caller) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'User not found.',
      });
    }
    const isRequestListing =
      filter.is_request === true ||
      (statusConfig.service && statusConfig.service.is_request === true);
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
    // total_service counts only is_request: false unless the client filters explicitly.
    if (
      (caller.type === USER_TYPE_SUPER_ADMIN || caller.type === USER_TYPE_STAFF) &&
      is_request === null &&
      filter.is_request === undefined
    ) {
      filter.is_request = false;
    }

    if (req.query.category_id) {
      const categoryResult = await checkObjectIdExists(Category, req.query.category_id, 'category');
      if (categoryResult.exists === false) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: categoryResult.message,
        });
      }
      const selectedCategoryId = new mongoose.Types.ObjectId(req.query.category_id);
      if (filter.category_id && filter.category_id.$in) {
        const matchesSelectedCategory = filter.category_id.$in.some(
          (id) => String(id) === String(selectedCategoryId)
        );
        filter.category_id = matchesSelectedCategory ? selectedCategoryId : { $in: [] };
      } else {
        filter.category_id = selectedCategoryId;
      }
    }
    if (req.query.city_id) {
      const cityResult = await checkObjectIdExists(City, req.query.city_id, 'city');
      if (cityResult.exists === false) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: cityResult.message,
        });
      }
      filter.city_ids = { $in: [new mongoose.Types.ObjectId(req.query.city_id)] };
    }

    const trimQuery = (key) =>
      req.query[key] !== undefined && String(req.query[key]).trim()
        ? String(req.query[key]).trim()
        : '';

    const rawSearch = trimQuery('search');
    const serviceNameParam = trimQuery('service_name') || trimQuery('name');
    const categoryParam = trimQuery('category') || trimQuery('category_name');

    if (rawSearch) {
      const sanitized = sanitizeInput(rawSearch);
      const searchRegex = new RegExp(sanitized, 'i');
      const matchingCategories = await Category.find({
        deleted_at: null,
        $or: [{ name: searchRegex }, { category_name: searchRegex }],
      }).select('_id');
      const categoryIdsFromSearch = matchingCategories.map((c) => c._id);
      const searchOr = [{ name: searchRegex }];
      if (categoryIdsFromSearch.length > 0) {
        searchOr.push({ category_id: { $in: categoryIdsFromSearch } });
      }
      if (filter.category_id) {
        const selectedId = filter.category_id;
        filter.$and = [
          { category_id: selectedId },
          { $or: searchOr },
        ];
        delete filter.category_id;
      } else {
        filter.$or = searchOr;
      }
    } else {
      if (serviceNameParam) {
        const sanitized = sanitizeInput(serviceNameParam);
        filter.name = { $regex: new RegExp(sanitized, 'i') };
      }
      if (categoryParam) {
        const sanitized = sanitizeInput(categoryParam);
        const catRegex = new RegExp(sanitized, 'i');
        const matchingCategories = await Category.find({
          deleted_at: null,
          $or: [{ name: catRegex }, { category_name: catRegex }],
        }).select('_id');
        const categoryIdsFromName = matchingCategories.map((c) => c._id);
        if (filter.category_id) {
          const selectedId = filter.category_id;
          const matches = categoryIdsFromName.some((id) => id.equals(selectedId));
          if (!matches) {
            filter.category_id = { $in: [] };
          }
        } else {
          filter.category_id =
            categoryIdsFromName.length > 0 ? { $in: categoryIdsFromName } : { $in: [] };
        }
      }
    }

    const sortDir =
      req.query.sort_order !== undefined
        ? parseInt(req.query.sort_order, 10) === -1
          ? -1
          : 1
        : 1;
    const sortByParam = (req.query.sort_by || 'name')
      .toString()
      .toLowerCase()
      .replace(/-/g, '_');
    const sortByCategory =
      sortByParam === 'category_name' || sortByParam === 'category';

    const sort = { name: sortDir };

    let services;
    let totalCount;
    let totalPages;
    let currentPage;

    if (sortByCategory) {
      const skip = (page - 1) * limit;
      const categoryColl = Category.collection.collectionName || Category.collection.name;
      const pipeline = [
        { $match: filter },
        {
          $lookup: {
            from: categoryColl,
            localField: 'category_id',
            foreignField: '_id',
            as: '_catSort',
          },
        },
        {
          $addFields: {
            _categorySortKey: {
              $toLower: {
                $let: {
                  vars: { cat: { $arrayElemAt: ['$_catSort', 0] } },
                  in: {
                    $ifNull: [
                      '$$cat.name',
                      { $ifNull: ['$$cat.category_name', ''] },
                    ],
                  },
                },
              },
            },
          },
        },
        { $sort: { _categorySortKey: sortDir } },
        {
          $facet: {
            data: [
              { $skip: skip },
              { $limit: limit },
              { $project: { _catSort: 0, _categorySortKey: 0 } },
            ],
            totalCount: [{ $count: 'totalCount' }],
          },
        },
      ];
      const aggResult = await Service.aggregate(pipeline);
      const facet = aggResult[0] || { data: [], totalCount: [] };
      services = facet.data || [];
      totalCount = facet.totalCount[0]?.totalCount ?? 0;
      totalPages = Math.ceil(totalCount / limit);
      currentPage = page;
    } else {
      const paginated = await applyPagination(Service, filter, page, limit, sort);
      services = paginated.data;
      totalCount = paginated.totalCount;
      totalPages = paginated.totalPages;
      currentPage = paginated.currentPage;
    }

    const populateOptions = services.map(() => {

      return [
        { path: "category_id" },
        { path: "city_ids" },
      ];
    });

    const populatedService = await Promise.all(
      services.map((order, index) =>
        Service.populate(order, populateOptions[index])
      )
    );

    const calculateServicePrice = (service) => {
      const cities = Array.isArray(service.city_ids) ? service.city_ids : [];
      let service_price = null;
      if (req.query.city_id) {
        const selectedCityId = new mongoose.Types.ObjectId(req.query.city_id);
        const city =
          cities.find(
            (c) =>
              c &&
              c._id &&
              typeof c._id.equals === 'function' &&
              c._id.equals(selectedCityId)
          ) || {};
        service_price = city.city_service_price ?? 0;
      }
      const cat = service.category_id;
      const category_id =
        cat &&
        typeof cat === 'object' &&
        cat._id &&
        typeof cat._id.equals === 'function'
          ? cat._id
          : cat ?? null;
      const category_name =
        cat && typeof cat === 'object' && !(cat instanceof mongoose.Types.ObjectId)
          ? cat.category_name ?? cat.name ?? null
          : null;
      const city_ids = cities
        .map((city) =>
          city && typeof city === 'object' && city._id ? city._id : city
        )
        .filter((id) => id != null);

      return {
        ...service,
        category_id,
        category_name,
        service_price,
      };
    };
    const processedService = populatedService.map(calculateServicePrice);
    const enrichedServices = await attachRequestedByUser(processedService);
    const responseServices = enrichedServices.map((service) =>
      stripServiceLocationFields(service)
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: "Service list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: responseServices,
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
      tax,
      commission,
      payment_type,
      minimum_deposit,
      category_id,
      city_ids = [],
      state_ids = [],
      image_url,
      is_active,
      rejection_reason,
    } = req.body;

    const trimmedName = normalizeCatalogName(name);
    const existingService = await Service.findOne(serviceNameExistsQuery(trimmedName));

    if (existingService) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'Service name already exists.',
      });
    }

    if (Array.isArray(state_ids) && state_ids.length > 0) {
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

    if (Array.isArray(city_ids) && city_ids.length > 0) {
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

    const service_id = await getServiceId();
    const isRequest = Boolean(
      (typeof req.path === "string" && req.path.includes("/create-request")) ||
        asBodyBool(req.body.is_request, false)
    );
    const nextIsActive = isRequest ? asBodyBool(is_active, false) : asBodyBool(is_active, true);

    const activationCheck = await validateGlobalServiceActivation({
      categoryId: category_id,
      isActive: nextIsActive,
      isRequest,
    });
    if (!activationCheck.ok) {
      return res.status(activationCheck.status).json({
        success: false,
        status: activationCheck.status,
        message: activationCheck.message,
      });
    }

    const newService = new Service({
      name: trimmedName,
      desc,
      tax: asBodyNumber(tax, 0),
      commission: asBodyNumber(commission, 0),
      payment_type: normalizePaymentType(payment_type),
      minimum_deposit: asBodyNumber(minimum_deposit, 0),
      category_id,
      service_id,
      city_ids,
      state_ids,
      image_url,
      is_active: nextIsActive,
      is_request: isRequest,
      approval_status: isRequest ? "pending" : "approve",
      rejection_reason: null,
      requested_by: isRequest ? req.user.id : null,
    });


    const savedService = await newService.save();

    if (savedService.is_request) {
      void safeNotifyBackofficeServiceRequested({
        service: savedService,
        actorUserId: req.user?.id || req.user?._id || null,
      });
    }

    const category = await Category.findById(category_id);
    if (category) {
      if (!Array.isArray(category.services)) {
        category.services = [];
      }
      category.services.push(savedService._id);
      await category.save();
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Service created successfully.',
      record: stripServiceLocationFields(savedService),
    });
  } catch (error) {
    console.error('Error creating Service:', error.message);
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
  console.log("Hello.........");
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const updateData = { ...req.body };
  delete updateData.requested_by;
  if (typeof req.path === "string" && req.path.includes("/update-request")) {
    updateData.is_request = true;
  }
  if (Object.prototype.hasOwnProperty.call(updateData, "tax")) {
    updateData.tax = asBodyNumber(updateData.tax, 0);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, "commission")) {
    updateData.commission = asBodyNumber(updateData.commission, 0);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, "minimum_deposit")) {
    updateData.minimum_deposit = asBodyNumber(updateData.minimum_deposit, 0);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, "payment_type")) {
    updateData.payment_type = normalizePaymentType(updateData.payment_type);
  }

  try {

    const service = await Service.findById(id);

    if (!service) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    const wasGloballyActive = isGlobalCatalogRowActive(service);
    const previousApprovalStatus = service.approval_status;

    if (req.body.name) {
      const trimmedName = normalizeCatalogName(req.body.name);
      const existingService = await Service.findOne(serviceNameExistsQuery(trimmedName, id));

      if (existingService) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: 'Service name already exists.',
        });
      }
      updateData.name = trimmedName;
    }
    if (
      req.body.state_ids &&
      Array.isArray(req.body.state_ids) &&
      req.body.state_ids.length > 0
    ) {
      const stateResult = await checkObjectIdExists(State, req.body.state_ids, 'state');
      if (stateResult.exists === false) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: stateResult.message,
        });
      }
    }
    if (
      req.body.city_ids &&
      Array.isArray(req.body.city_ids) &&
      req.body.city_ids.length > 0
    ) {
      const cityResult = await checkObjectIdExists(City, req.body.city_ids, 'service');
      if (cityResult.exists === false) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: cityResult.message,
        });
      }
    }

    const prevCategoryId = service.category_id;

    if (updateData.is_request !== undefined) {
      updateData.is_request = asBodyBool(updateData.is_request, service.is_request);
    }
    if (updateData.approval_status !== undefined) {
      updateData.approval_status = asApprovalStatus(updateData.approval_status, service.approval_status);
    }
    if (updateData.is_rejected !== undefined) {
      const nextRejectedState = asBodyBool(updateData.is_rejected, null);
      if (nextRejectedState === true) updateData.approval_status = "rejected";
      else if (nextRejectedState === false) updateData.approval_status = "approve";
      delete updateData.is_rejected;
    }
    if (updateData.rejection_reason !== undefined) {
      updateData.rejection_reason =
        updateData.rejection_reason === null || updateData.rejection_reason === ""
          ? null
          : String(updateData.rejection_reason);
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
      updateData.rejection_reason = service.approval_status === "rejected"
        ? (updateData.rejection_reason === null || updateData.rejection_reason === ""
          ? null
          : String(updateData.rejection_reason))
        : null;
    }

    let nextIsRequest = service.is_request;
    if (updateData.is_request !== undefined) {
      nextIsRequest = asBodyBool(updateData.is_request, service.is_request);
    }
    if (updateData.approval_status === "approve") {
      nextIsRequest = false;
    } else if (
      updateData.approval_status === "rejected" ||
      updateData.approval_status === "pending"
    ) {
      nextIsRequest = true;
    }
    if (typeof req.path === "string" && req.path.includes("/update-request")) {
      nextIsRequest = true;
    }

    const nextIsActive = Object.prototype.hasOwnProperty.call(updateData, "is_active")
      ? asBodyBool(updateData.is_active, service.is_active)
      : service.is_active;
    const nextCategoryId = Object.prototype.hasOwnProperty.call(updateData, "category_id")
      ? updateData.category_id
      : service.category_id;

    const activationCheck = await validateGlobalServiceActivation({
      categoryId: nextCategoryId,
      isActive: nextIsActive,
      isRequest: nextIsRequest,
    });
    if (!activationCheck.ok) {
      return res.status(activationCheck.status).json({
        success: false,
        status: activationCheck.status,
        message: activationCheck.message,
      });
    }

    Object.keys(updateData).forEach((key) => {
      service[key] = updateData[key];
    });

    service.updated_at = Date.now();
    const updatedService = await service.save();

    if (
      updatedService.approval_status !== previousApprovalStatus &&
      ["approve", "rejected"].includes(String(updatedService.approval_status || "").toLowerCase())
    ) {
      void safeNotifyBackofficeCatalogReviewed({
        entityType: "service",
        entity: updatedService,
        approvalStatus: updatedService.approval_status,
        actorUserId: req.user?.id || req.user?._id || null,
      });
    }

    if (wasGloballyActive && updatedService.is_active === false) {
      try {
        await onGlobalServiceDeactivated(updatedService._id);
      } catch (cascadeErr) {
        console.error('service update cascade failed:', cascadeErr.message);
      }
    }

    const prevCatStr = prevCategoryId ? prevCategoryId.toString() : "";
    const newCatStr = updatedService.category_id
      ? updatedService.category_id.toString()
      : "";

    if (prevCatStr !== newCatStr) {
      if (prevCategoryId) {
        const oldCat = await Category.findById(prevCategoryId);
        if (oldCat) {
          const oldList = Array.isArray(oldCat.services) ? oldCat.services : [];
          oldCat.services = oldList.filter((s) => !s.equals(updatedService._id));
          await oldCat.save();
        }
      }
      if (updatedService.category_id) {
        const newCat = await Category.findById(updatedService.category_id);
        if (newCat) {
          if (!Array.isArray(newCat.services)) {
            newCat.services = [];
          }
          if (!newCat.services.some((s) => s.equals(updatedService._id))) {
            newCat.services.push(updatedService._id);
          }
          await newCat.save();
        }
      }
    } else if (updatedService.category_id) {
      const cat = await Category.findById(updatedService.category_id);
      if (cat && Array.isArray(cat.services)) {
        const hasEntry = cat.services.some((s) => s.equals(updatedService._id));
        if (!hasEntry) {
          cat.services.push(updatedService._id);
          await cat.save();
        }
      }
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Service updated successfully',
      record: stripServiceLocationFields(updatedService),
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
  const statusFilter =
    req.query.status !== undefined && req.query.status !== null
      ? String(req.query.status).trim().toLowerCase()
      : "";

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid service id.',
      });
    }

    const service = await Service.findById(id);

    if (!service) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }
    const statusConfig = getServiceStatusConfig(statusFilter);
    if (statusConfig.service) {
      if (
        Object.prototype.hasOwnProperty.call(statusConfig.service, "is_active") &&
        service.is_active !== statusConfig.service.is_active
      ) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'No record found'
        });
      }
      if (
        Object.prototype.hasOwnProperty.call(statusConfig.service, "is_request") &&
        service.is_request !== statusConfig.service.is_request
      ) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'No record found'
        });
      }
    }
    if (statusConfig.category) {
      const category = await Category.findOne({
        _id: service.category_id,
        deleted_at: null,
      }).select("is_active is_request");
      if (!category) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'No record found'
        });
      }
      if (
        Object.prototype.hasOwnProperty.call(statusConfig.category, "is_active") &&
        category.is_active !== statusConfig.category.is_active
      ) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'No record found'
        });
      }
      if (
        Object.prototype.hasOwnProperty.call(statusConfig.category, "is_request") &&
        category.is_request !== statusConfig.category.is_request
      ) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'No record found'
        });
      }
    }
    let response = service.toObject();
    if (req.query.city_id) {
      const cityResult = await checkObjectIdExists(City, req.query.city_id, 'city');
      if (cityResult.exists === false) {
        const statusCode = getIdValidationStatus(cityResult.message);
        return res.status(statusCode).json({
          success: false,
          status: statusCode,
          message: cityResult.message,
        });
      }
      const selectedCityId = new mongoose.Types.ObjectId(req.query.city_id);
      const city = await City.findById(selectedCityId);
      response.service_price = city?.city_service_price ?? 0;
    }
    let category_name = null;
    if (service.category_id) {
      const catDoc = await Category.findById(service.category_id).lean();
      if (catDoc) {
        category_name = catDoc.category_name ?? catDoc.name ?? null;
      }
    }
    response.category_name = category_name;
    const [enrichedService] = await attachRequestedByUser([response]);
    res.status(200).json({
      success: true,
      status: 201,
      message: 'Service fetched successfully',
      record: stripServiceLocationFields(enrichedService),
    });
  } catch (error) {
    console.error('Error fetching Service:', error);
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
const deleteService = async (req, res) => {
  const { id } = req.params;

  try {

    const service = await Service.findById(id);

    if (!service) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }


    if (service.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Service is already deleted'
      });
    }


    if (isGlobalCatalogRowActive(service)) {
      try {
        await onGlobalServiceDeactivated(service._id);
      } catch (cascadeErr) {
        console.error('service delete cascade failed:', cascadeErr.message);
      }
    }

    service.deleted_at = new Date();
    service.updated_at = Date.now();

    await service.save();
    const category = await Category.findById(service.category_id);
    if (category) {
      const list = Array.isArray(category.services) ? category.services : [];
      category.services = list.filter((s) => !s._id.equals(service._id));
      await category.save();
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Service deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Service:', error);
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
          message: 'Each record must include a non-empty service name.',
        });
      }
    }
    const importDupMsg = importFileDuplicateNamesMessage(
      normalizedRows.map((r) => r.name),
      'service'
    );
    if (importDupMsg) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: importDupMsg,
      });
    }
    const existingRecords = await findExistingCatalogNames(
      Service,
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
    const result = await Service.insertMany(enrichedRecords, { ordered: false });

    res.status(200).json({
      success: true,
      status: 200,
      message: `${result.length} records added successfully!`,
      records: result.map((record) => stripServiceLocationFields(record)),
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
    if (req.query.category_id) {

      const categoryResult = await checkObjectIdExists(Category, req.query.category_id, 'category');
      if (categoryResult.exists === false) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: categoryResult.message,
        });
      }
      filter.category_id = new mongoose.Types.ObjectId(req.query.category_id);
    }
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
    const { data: services, } = await applyDropDownFilter(
      Service,
      filter,
      sort
    );

    const responseServices = services.map((service) =>
      stripServiceLocationFields(service)
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: "Service list fetched successfully.",
      records: responseServices,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};
module.exports = { getAll, create, update, getById, deleteService, importRecords, getDropDown };