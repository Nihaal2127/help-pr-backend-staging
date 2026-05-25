const mongoose = require("mongoose");
const PartnerService = require('../models/partner_service');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');
const { validationResult } = require('express-validator');
const { validateObjectId } = require('../validator/form_validator');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const Service = require("../models/service");
const Category = require("../models/category");
const {
  syncPartnerServicesFromPartnerCategories,
  rebuildPartnerCategoriesFromPartnerServices,
  mergeServicesIntoPartnerCategories,
} = require('../services/partner_category_service');
const {
  resolvePartnerFranchiseCatalog,
  resolveFranchiseEffectiveCatalog,
} = require('../utils/partner_franchise_catalog');
const { fieldLabel } = require('../utils/field_labels');
const {
  loadPartnerAvailabilityContext,
  enrichPartnerServiceApiRecord,
} = require('../utils/catalog_availability_resolver');

const getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const type = parseInt(req.query.type);
    const is_active = req.query.is_active !== undefined ? parseBoolean(req.query.is_active) : null;
    const filter = {
      deleted_at: null,
      ...(req.query.type && { type: type }),
      ...(req.query.is_active && { is_active: is_active }),
    };
    if (req.query.partner_id) {
      const partnerResult = validateObjectId(req.query.partner_id, 'partner');
      if (partnerResult.valid === true) {
        filter.partner_id = new mongoose.Types.ObjectId(req.query.partner_id);
      } else {
        return res.status(400).json({
          success: false,
          status: 400,
          message: partnerResult.message,
        });
      }
    }
    if (req.query.name) {
      filter.name = { $regex: new RegExp(req.query.name, 'i') };
    }

    const sort = { created_at: -1 };

    const { data: services, totalCount, totalPages, currentPage } = await applyPagination(
      PartnerService,
      filter,
      page,
      limit,
      sort
    );

    const populatedServices = await PartnerService.populate(services, [
      {
        path: 'service_id',
        select: 'name image_url category_id is_active is_request approval_status',
      },
      { path: 'category_id', select: 'name is_active is_request approval_status' },
    ]);

    const partnerOid = filter.partner_id;
    const ctx =
      partnerOid ? await loadPartnerAvailabilityContext(partnerOid) : null;

    let processedServices = populatedServices.map((service) => {
      const { service_id, category_id, ...rest } = service;
      const base = {
        ...rest,
        service_id: service_id?._id || service.service_id,
        service_name: service_id?.name || null,
        category_id: category_id?._id || rest.category_id,
        category_name: category_id?.name || null,
      };
      if (ctx && ctx.ok) {
        return enrichPartnerServiceApiRecord(base, ctx, service_id, category_id);
      }
      return base;
    });

    if (
      req.query.effective_active !== undefined &&
      req.query.effective_active !== '' &&
      ctx &&
      ctx.ok
    ) {
      const wantEffective = parseBoolean(req.query.effective_active);
      processedServices = processedServices.filter(
        (r) => Boolean(r.effective_active) === wantEffective
      );
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Partner Service list fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processedServices,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};
const createOld = async (req, res) => {
  try {
    const {
      services,
    } = req.body;


    const savedServices = await PartnerService.insertMany(services);

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Service added successfully.',
      record: savedServices,
    });
  } catch (error) {
    console.error('Error adding services:', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const createNew = async (req, res) => {
  try {
    const records = req.body.services;
    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ success: false, status: 400, message: 'Invalid input. Expected an array of records.' });
    }
    if (records.length === 0) {
      return res.status(400).json({ success: false, status: 400, message: 'Please add records in the Excel sheet.' });
    }
    const partnerIds = [...new Set(records.map(record => record.partner_id))];
    const serviceIds = [...new Set(records.map(record => record.service_id))];
    console.log('partnerIds', partnerIds);
    console.log('serviceIds', serviceIds);
    const existingServices = await PartnerService.find({ service_id: { $in: serviceIds }, partner_id: { $in: partnerIds } }).select('_id service_id');
    const existingServiceMap = new Map(existingServices.map(service => [service.service_id, service]));
    const servicesToInsert = [];
    const errorMessages = [];
    console.log('existingServices', existingServices);
    console.log('existingServiceMap', existingServiceMap);
    for (const record of records) {
      console.log('record.service_id', record.service_id);

      if (!existingServiceMap.has(new mongoose.Types.ObjectId(record.service_id))) {
        servicesToInsert.push({
          ...record
        });
      }
      else {
        errorMessages.push('already added');
      }
    }
    console.log('Service to instert', servicesToInsert);

    if (servicesToInsert.length > 0) await PartnerService.insertMany(servicesToInsert);
    const totalProcessed = servicesToInsert.length - errorMessages.length;
    if (errorMessages.length > 0) {
      return res.status(207).json({
        success: false,
        status: 207,
        message: `Partial success: ${totalProcessed} service added successfully.\n${errorMessages.length} records failed due to alredy exist.`,
        data: {
          updatedRecords: variantsToUpdate.length,
          insertedRecords: variantsToInsert.length,
          failedRecords: errorMessages.length
        },
        errors: errorMessages
      });
    }
    return res.status(201).json({
      success: true,
      status: 201,
      message: `${totalProcessed} Service added successfully.`,
    });

  } catch (error) {
    console.log("Eror ", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: error.message
    });
  }
};

const create = async (req, res) => {
  try {
    const records = req.body.services;

    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ success: false, status: 400, message: 'Invalid input. Expected an array of records.' });
    }

    if (records.length === 0) {
      return res.status(400).json({ success: false, status: 400, message: 'Please add records in the Excel sheet.' });
    }

    const partnerIds = [...new Set(records.map(record => record.partner_id))];
    const serviceIds = [...new Set(records.map(record => record.service_id))];



    // Fetch existing records from DB
    const existingServices = await PartnerService.find({
      service_id: { $in: serviceIds.map(id => new mongoose.Types.ObjectId(id)) },
      partner_id: { $in: partnerIds.map(id => new mongoose.Types.ObjectId(id)) }
    }).select('_id service_id partner_id');



    // Create a Map with keys as `partner_id-service_id` for easy lookup
    const existingServiceMap = new Map(
      existingServices.map(service => [`${service.partner_id.toString()}-${service.service_id.toString()}`, true])
    );



    const servicesToInsert = [];
    const errorMessages = [];


    for (const record of records) {
      const key = `${record.partner_id}-${record.service_id}`;

      // If service_id & partner_id combination does not exist, add to insert list
      if (!existingServiceMap.has(key)) {
        servicesToInsert.push({
          partner_id: new mongoose.Types.ObjectId(record.partner_id),
          service_id: new mongoose.Types.ObjectId(record.service_id),
          ...record
        });
      } else {
        errorMessages.push(`Service ID ${record.service_id} for Partner ID ${record.partner_id} already exists.`);
      }
    }

    // Insert only if there are new services
    if (servicesToInsert.length > 0) {
      await PartnerService.insertMany(servicesToInsert);
      const partnerOidSet = new Set(servicesToInsert.map((r) => String(r.partner_id)));
      for (const pid of partnerOidSet) {
        await rebuildPartnerCategoriesFromPartnerServices(pid);
      }
    }

    const insertedCount = servicesToInsert.length;
    const failedCount = errorMessages.length;

    if (failedCount > 0) {
      return res.status(207).json({
        success: false,
        status: 207,
        message: insertedCount > 0 ? `Partial success: ${insertedCount} services added successfully. ${failedCount} services already exist.` : `Selected services already exist.`,
        data: {
          insertedRecords: insertedCount,
          failedRecords: failedCount
        },
        errors: errorMessages
      });
    }

    return res.status(201).json({
      success: true,
      status: 201,
      message: `${insertedCount} services added successfully.`,
    });

  } catch (error) {
    console.error('Error:', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: error.message
    });
  }
};

const updateStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;


  try {

    const partnerService = await PartnerService.findById(id);

    if (!partnerService) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    partnerService.is_accept_request = !partnerService.is_accept_request;
    await partnerService.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Service status updated successfully',
    });
  } catch (error) {
    console.error('Error updating PartnerService:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const deleteState = async (req, res) => {
  const { id } = req.params;

  try {

    const partnerService = await PartnerService.findById(id);

    if (!partnerService) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }


    if (partnerService.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Partner Service is already deleted'
      });
    }


    partnerService.deleted_at = new Date();


    await partnerService.save();

    await rebuildPartnerCategoriesFromPartnerServices(partnerService.partner_id);

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Partner Service deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting PartnerService:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const getDropDown = async (req, res) => {

  try {

    const filter = {
      deleted_at: null
    };

    if (req.query.partner_id) {
      const partnerResult = validateObjectId(req.query.partner_id, 'partner')
      if (partnerResult.valid === true) {
        filter.partner_id = new mongoose.Types.ObjectId(req.query.partner_id);
      } else {
        return res.status(409).json({
          success: false,
          status: 409,
          message: partnerResult.message,
        });
      }
    }

    if (req.query.service_id) {

      const serviceResult = await checkObjectIdExists(Service, req.query.service_id, 'service');
      if (serviceResult.exists === false) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: serviceResult.message,
        });
      }
      filter.service_id = new mongoose.Types.ObjectId(req.query.service_id);
    }

    const sort = { created_at: -1 };

    const { data: services, } = await applyDropDownFilter(
      PartnerService,
      filter,
      sort
    );

    const populatedServices = await PartnerService.populate(services, [
      {
        path: 'service_id',
        select: 'name image_url category_id is_active is_request approval_status',
      },
    ]);



    const processedServices = populatedServices.map(service => {

      const { service_id, ...rest } = service;
      return {
        ...rest,
        service_id: service.service_id._id,
        service_name: service.service_id.name,
      };
    });

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Partner Service list fetched successfully.',
      records: processedServices,
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



// ─────────────────────────────────────────────────────────────
// Partner-scoped routes (partner_id is taken from req.user.id)
// All five require authMiddleware + requirePartner upstream.
// ─────────────────────────────────────────────────────────────

// GET /api/partner_service/myServices
const getMyServices = async (req, res) => {
  try {
    const partnerId = new mongoose.Types.ObjectId(req.user.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const filter = {
      partner_id: partnerId,
      deleted_at: null,
    };

    // Only apply the boolean filter when an explicit value was provided
    if (req.query.is_accept_request !== undefined && req.query.is_accept_request !== '') {
      filter.is_accept_request = parseBoolean(req.query.is_accept_request);
    }

    if (req.query.category_id) {
      const categoryResult = validateObjectId(req.query.category_id, 'category');
      if (!categoryResult.valid) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: categoryResult.message,
        });
      }
      filter.category_id = new mongoose.Types.ObjectId(req.query.category_id);
    }

    // Pre-resolve service_ids whose name matches so the filter is applied
    // at the DB layer (and pagination remains consistent).
    if (req.query.name) {
      const matchingServices = await Service.find({
        name: { $regex: new RegExp(req.query.name, 'i') },
        deleted_at: null,
      }).select('_id');
      filter.service_id = { $in: matchingServices.map((s) => s._id) };
    }

    const sort = { created_at: -1 };
    const { data: services, totalCount, totalPages, currentPage } = await applyPagination(
      PartnerService,
      filter,
      page,
      limit,
      sort
    );

    const populated = await PartnerService.populate(services, [
      {
        path: 'service_id',
        select: 'name image_url category_id is_active is_request approval_status',
      },
      { path: 'category_id', select: 'name is_active is_request approval_status' },
    ]);

    const ctx = await loadPartnerAvailabilityContext(partnerId);
    if (!ctx.ok) {
      return res.status(ctx.status).json({
        success: false,
        status: ctx.status,
        message: ctx.message,
      });
    }

    let processed = populated.map((ps) => {
      const { service_id, category_id, ...rest } = ps;
      const base = {
        ...rest,
        service_id: service_id?._id || null,
        service_name: service_id?.name || null,
        service_image: service_id?.image_url || null,
        service_price: rest.price ?? null,
        category_id: category_id?._id || null,
        category_name: category_id?.name || null,
      };
      return enrichPartnerServiceApiRecord(base, ctx, service_id, category_id);
    });

    if (req.query.effective_active !== undefined && req.query.effective_active !== '') {
      const wantEffective = parseBoolean(req.query.effective_active);
      processed = processed.filter((r) => Boolean(r.effective_active) === wantEffective);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'My services fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processed,
    });
  } catch (err) {
    console.error('getMyServices error:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

// GET /api/partner_service/availableServices
// Lists services from the master catalog that the partner has NOT yet added.
const getAvailableServices = async (req, res) => {
  try {
    const partnerId = new mongoose.Types.ObjectId(req.user.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const taken = await PartnerService.find({
      partner_id: partnerId,
      deleted_at: null,
    }).select('service_id');
    const takenIds = taken.map((t) => t.service_id).filter(Boolean);

    const filter = {
      _id: { $nin: takenIds },
      deleted_at: null,
      is_active: true,
      approval_status: 'approve',
    };

    if (req.query.category_id) {
      const categoryResult = validateObjectId(req.query.category_id, 'category');
      if (!categoryResult.valid) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: categoryResult.message,
        });
      }
      filter.category_id = new mongoose.Types.ObjectId(req.query.category_id);
    }

    if (req.query.name) {
      filter.name = { $regex: new RegExp(req.query.name, 'i') };
    }

    const sort = { created_at: -1 };
    const { data: services, totalCount, totalPages, currentPage } = await applyPagination(
      Service,
      filter,
      page,
      limit,
      sort,
      {},
      [{ path: 'category_id' }]
    );

    const processed = services.map((s) => ({
      _id: s._id,
      name: s.name,
      desc: s.desc,
      tax: s.tax,
      image_url: s.image_url,
      category_id: s.category_id?._id || null,
      category_name: s.category_id?.name || null,
    }));

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Available services fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processed,
    });
  } catch (err) {
    console.error('getAvailableServices error:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

// GET /api/partner_service/availableFranchiseCategories
// Active, approved categories configured on the partner's franchise (for add-service flows).
const getAvailableFranchiseCategories = async (req, res) => {
  try {
    const partnerId = new mongoose.Types.ObjectId(req.user.id);
    const resolved = await resolvePartnerFranchiseCatalog(partnerId);
    if (!resolved.ok) {
      return res.status(resolved.status).json({
        success: false,
        status: resolved.status,
        message: resolved.message,
      });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    const { categoryIds } = resolved;
    if (categoryIds.length === 0) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'No categories configured for your franchise.',
        totalItems: 0,
        totalPages: 0,
        currentPage: page,
        records: [],
      });
    }

    const filter = {
      _id: { $in: categoryIds },
      deleted_at: null,
      is_active: true,
      is_request: false,
      approval_status: 'approve',
    };

    if (req.query.name) {
      filter.name = { $regex: new RegExp(sanitizeInput(String(req.query.name)), 'i') };
    }

    const sort = { created_at: -1 };
    const { data, totalCount, totalPages, currentPage } = await applyPagination(
      Category,
      filter,
      page,
      limit,
      sort
    );

    const processed = data.map((c) => ({
      _id: c._id,
      name: c.name,
      desc: c.desc,
      image_url: c.image_url,
    }));

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Franchise categories fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processed,
    });
  } catch (err) {
    console.error('getAvailableFranchiseCategories error:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

// GET /api/partner_service/availableFranchiseServices?category_id=
// Active, approved franchise services for one category; excludes services already on the partner profile.
const getAvailableFranchiseServices = async (req, res) => {
  try {
    const partnerId = new mongoose.Types.ObjectId(req.user.id);
    const resolved = await resolvePartnerFranchiseCatalog(partnerId);
    if (!resolved.ok) {
      return res.status(resolved.status).json({
        success: false,
        status: resolved.status,
        message: resolved.message,
      });
    }

    const { categoryIds, serviceIds } = resolved;

    if (!req.query.category_id) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `${fieldLabel('category_id')} query parameter is required.`,
      });
    }

    const categoryResult = validateObjectId(req.query.category_id, 'category');
    if (!categoryResult.valid) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: categoryResult.message,
      });
    }

    const categoryOid = new mongoose.Types.ObjectId(req.query.category_id);
    const categoryAllowed = categoryIds.some((id) => id.toString() === categoryOid.toString());
    if (!categoryAllowed) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'This category is not available for your franchise.',
      });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    if (serviceIds.length === 0) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'No services configured for your franchise.',
        totalItems: 0,
        totalPages: 0,
        currentPage: page,
        records: [],
      });
    }

    const taken = await PartnerService.find({
      partner_id: partnerId,
      deleted_at: null,
    }).select('service_id');
    const takenSet = new Set(taken.map((t) => String(t.service_id)));
    const candidateIds = serviceIds.filter((id) => !takenSet.has(String(id)));

    if (candidateIds.length === 0) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'No franchise services left to add for this category.',
        totalItems: 0,
        totalPages: 0,
        currentPage: page,
        records: [],
      });
    }

    const filter = {
      _id: { $in: candidateIds },
      category_id: categoryOid,
      deleted_at: null,
      is_active: true,
      is_request: false,
      approval_status: 'approve',
    };

    if (req.query.name) {
      filter.name = { $regex: new RegExp(sanitizeInput(String(req.query.name)), 'i') };
    }

    const sort = { created_at: -1 };
    const { data: services, totalCount, totalPages, currentPage } = await applyPagination(
      Service,
      filter,
      page,
      limit,
      sort,
      {},
      [{ path: 'category_id' }]
    );

    const processed = services.map((s) => ({
      _id: s._id,
      name: s.name,
      desc: s.desc,
      tax: s.tax,
      image_url: s.image_url,
      category_id: s.category_id?._id || null,
      category_name: s.category_id?.name || null,
    }));

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Available franchise services fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processed,
    });
  } catch (err) {
    console.error('getAvailableFranchiseServices error:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

// POST /api/partner_service/addMyServices
// Body: { services: [{ service_id, category_id }] }
// partner_id is forced from req.user.id (cannot be spoofed via body).
const addMyServices = async (req, res) => {
  try {
    const partnerId = new mongoose.Types.ObjectId(req.user.id);
    const records = req.body.services;

    if (!records || !Array.isArray(records)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid input. Expected services to be an array.',
      });
    }
    if (records.length === 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Please provide at least one service.',
      });
    }

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const sv = validateObjectId(r.service_id, 'service');
      if (!sv.valid) {
        return res.status(400).json({ success: false, status: 400, message: sv.message });
      }
      const cv = validateObjectId(r.category_id, 'category');
      if (!cv.valid) {
        return res.status(400).json({ success: false, status: 400, message: cv.message });
      }
    }

    const catalog = await resolvePartnerFranchiseCatalog(partnerId);
    if (
      !catalog.ok &&
      !(
        catalog.status === 400 &&
        catalog.message === 'Partner account is not linked to a franchise.'
      )
    ) {
      return res.status(catalog.status).json({
        success: false,
        status: catalog.status,
        message: catalog.message,
      });
    }
    const enforceFranchise = catalog.ok === true;
    const franchiseCategorySet = enforceFranchise
      ? new Set(catalog.categoryIds.map((id) => String(id)))
      : null;
    const franchiseServiceSet = enforceFranchise
      ? new Set(catalog.serviceIds.map((id) => String(id)))
      : null;

    const serviceIds = [...new Set(records.map((r) => r.service_id.toString()))];
    const existing = await PartnerService.find({
      partner_id: partnerId,
      service_id: { $in: serviceIds.map((id) => new mongoose.Types.ObjectId(id)) },
      deleted_at: null,
    }).select('service_id');
    const existingSet = new Set(existing.map((e) => e.service_id.toString()));

    const toInsert = [];
    const errorMessages = [];

    for (const r of records) {
      if (existingSet.has(r.service_id.toString())) {
        errorMessages.push(`Service ${r.service_id} is already in your offerings.`);
        continue;
      }

      const service = await Service.findById(r.service_id);
      if (!service || service.deleted_at) {
        errorMessages.push(`Service ${r.service_id} does not exist.`);
        continue;
      }
      const category = await Category.findById(r.category_id);
      if (!category || category.deleted_at) {
        errorMessages.push(`Category ${r.category_id} does not exist.`);
        continue;
      }

      if (enforceFranchise) {
        if (!franchiseCategorySet.has(String(r.category_id))) {
          errorMessages.push(
            `Category ${r.category_id} is not offered by your franchise.`
          );
          continue;
        }
        if (!franchiseServiceSet.has(String(r.service_id))) {
          errorMessages.push(
            `Service ${r.service_id} is not offered by your franchise.`
          );
          continue;
        }
        if (String(service.category_id) !== String(r.category_id)) {
          errorMessages.push(
            `Service ${r.service_id} does not belong to the selected category.`
          );
          continue;
        }
        if (
          !service.is_active ||
          service.is_request ||
          service.approval_status !== 'approve'
        ) {
          errorMessages.push(`Service ${r.service_id} is not available to add.`);
          continue;
        }
        if (
          !category.is_active ||
          category.is_request ||
          category.approval_status !== 'approve'
        ) {
          errorMessages.push(`Category ${r.category_id} is not available to add.`);
          continue;
        }
      }

      toInsert.push({
        partner_id: partnerId,
        service_id: new mongoose.Types.ObjectId(r.service_id),
        category_id: new mongoose.Types.ObjectId(r.category_id),
        is_accept_request: r.is_accept_request === undefined ? true : !!r.is_accept_request,
      });
      existingSet.add(r.service_id.toString());
    }

    if (toInsert.length > 0) {
      await mergeServicesIntoPartnerCategories(
        partnerId,
        toInsert.map((t) => ({
          category_id: t.category_id,
          service_id: t.service_id,
        }))
      );
      await syncPartnerServicesFromPartnerCategories(partnerId);
      for (const t of toInsert) {
        await PartnerService.updateOne(
          {
            partner_id: partnerId,
            service_id: t.service_id,
            deleted_at: null,
          },
          {
            $set: {
              is_accept_request: t.is_accept_request,
              updated_at: new Date(),
            },
          }
        );
      }
    }

    if (errorMessages.length > 0) {
      return res.status(207).json({
        success: false,
        status: 207,
        message:
          toInsert.length > 0
            ? `Partial success: ${toInsert.length} added, ${errorMessages.length} skipped.`
            : `No services added.`,
        data: { insertedRecords: toInsert.length, failedRecords: errorMessages.length },
        errors: errorMessages,
      });
    }

    return res.status(201).json({
      success: true,
      status: 201,
      message: `${toInsert.length} services added successfully.`,
    });
  } catch (err) {
    console.error('addMyServices error:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: err.message,
    });
  }
};

// PUT /api/partner_service/updateMyService/:id
// Editable fields for the partner: category_id, is_accept_request.
const updateMyService = async (req, res) => {
  try {
    const partnerId = new mongoose.Types.ObjectId(req.user.id);
    const { id } = req.params;

    const idCheck = validateObjectId(id, 'partner service');
    if (!idCheck.valid) {
      return res.status(400).json({ success: false, status: 400, message: idCheck.message });
    }

    const partnerService = await PartnerService.findOne({
      _id: id,
      deleted_at: null,
    });
    if (!partnerService) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found.',
      });
    }

    if (partnerService.partner_id.toString() !== partnerId.toString()) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'You can only modify your own services.',
      });
    }

    const { category_id, is_accept_request } = req.body;

    if (category_id !== undefined) {
      const cv = validateObjectId(category_id, 'category');
      if (!cv.valid) {
        return res.status(400).json({ success: false, status: 400, message: cv.message });
      }
      const category = await Category.findById(category_id);
      if (!category || category.deleted_at) {
        return res.status(404).json({
          success: false,
          status: 404,
          message: 'Category not found.',
        });
      }
      partnerService.category_id = new mongoose.Types.ObjectId(category_id);
    }

    if (is_accept_request !== undefined) {
      partnerService.is_accept_request = !!is_accept_request;
    }

    partnerService.updated_at = new Date();
    await partnerService.save();

    await rebuildPartnerCategoriesFromPartnerServices(partnerId);

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Service updated successfully.',
      record: partnerService,
    });
  } catch (err) {
    console.error('updateMyService error:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

// POST /api/partner_service/toggleMyServiceStatus/:id
// Flips is_accept_request (the active/inactive switch) on the partner's own service.
const toggleMyServiceStatus = async (req, res) => {
  try {
    const partnerId = new mongoose.Types.ObjectId(req.user.id);
    const { id } = req.params;

    const idCheck = validateObjectId(id, 'partner service');
    if (!idCheck.valid) {
      return res.status(400).json({ success: false, status: 400, message: idCheck.message });
    }

    const partnerService = await PartnerService.findOne({
      _id: id,
      deleted_at: null,
    });
    if (!partnerService) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found.',
      });
    }

    if (partnerService.partner_id.toString() !== partnerId.toString()) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'You can only modify your own services.',
      });
    }

    partnerService.is_accept_request = !partnerService.is_accept_request;
    partnerService.updated_at = new Date();
    await partnerService.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: partnerService.is_accept_request
        ? 'Service marked active.'
        : 'Service marked inactive.',
      is_accept_request: partnerService.is_accept_request,
    });
  } catch (err) {
    console.error('toggleMyServiceStatus error:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

// POST /api/partner_service/franchiseCategoryServices
// Body: { franchise_id, category_id } — category.services ∩ effectively available franchise services.
const getFranchiseCategoryServicesIntersection = async (req, res) => {
  try {
    const franchiseIdRaw =
      req.body.franchise_id !== undefined && req.body.franchise_id !== null
        ? String(req.body.franchise_id).trim()
        : '';
    const categoryIdRaw =
      req.body.category_id !== undefined && req.body.category_id !== null
        ? String(req.body.category_id).trim()
        : '';

    if (!franchiseIdRaw) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `${fieldLabel('franchise_id')} is required.`,
      });
    }
    if (!categoryIdRaw) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `${fieldLabel('category_id')} is required.`,
      });
    }

    const fv = validateObjectId(franchiseIdRaw, 'franchise');
    if (!fv.valid) {
      return res.status(400).json({ success: false, status: 400, message: fv.message });
    }
    const cv = validateObjectId(categoryIdRaw, 'category');
    if (!cv.valid) {
      return res.status(400).json({ success: false, status: 400, message: cv.message });
    }

    const fid = new mongoose.Types.ObjectId(franchiseIdRaw);
    const cid = new mongoose.Types.ObjectId(categoryIdRaw);

    const [category, franchiseCatalog] = await Promise.all([
      Category.findOne({ _id: cid, deleted_at: null }).select('services').lean(),
      resolveFranchiseEffectiveCatalog(fid),
    ]);

    if (!category) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Category not found.',
      });
    }
    if (!franchiseCatalog.ok) {
      return res.status(franchiseCatalog.status).json({
        success: false,
        status: franchiseCatalog.status,
        message: franchiseCatalog.message,
      });
    }

    const catServices = Array.isArray(category.services) ? category.services : [];
    const effectiveSvcSet = new Set(
      (franchiseCatalog.effectiveServiceIds || []).map((x) => String(x))
    );
    const categoryEffective = (franchiseCatalog.effectiveCategoryIds || []).some(
      (id) => String(id) === String(cid)
    );
    const intersectionIds = categoryEffective
      ? catServices.filter((sid) => sid && effectiveSvcSet.has(String(sid)))
      : [];

    if (intersectionIds.length === 0) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'No common services between category and franchise.',
        records: [],
      });
    }

    const services = await Service.find({
      _id: { $in: intersectionIds },
      deleted_at: null,
    })
      .select('name desc tax image_url category_id is_active approval_status')
      .lean();

    const byId = new Map(services.map((s) => [String(s._id), s]));
    const ordered = intersectionIds.map((id) => byId.get(String(id))).filter(Boolean);

    const records = ordered.map((s) => ({
      _id: s._id,
      name: s.name,
      desc: s.desc,
      tax: s.tax,
      image_url: s.image_url,
      category_id: s.category_id,
      is_active: s.is_active,
      approval_status: s.approval_status,
    }));

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Common franchise and category services fetched successfully.',
      records,
    });
  } catch (err) {
    console.error('getFranchiseCategoryServicesIntersection error:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  getAll,
  create,
  updateStatus,
  deleteState,
  getDropDown,
  getMyServices,
  getAvailableServices,
  getAvailableFranchiseCategories,
  getAvailableFranchiseServices,
  addMyServices,
  updateMyService,
  toggleMyServiceStatus,
  getFranchiseCategoryServicesIntersection,
};