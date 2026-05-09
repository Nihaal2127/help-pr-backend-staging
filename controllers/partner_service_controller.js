const mongoose = require("mongoose");
const PartnerService = require('../models/partner_service');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');
const { validationResult } = require('express-validator');
const { validateObjectId } = require('../validator/form_validator');
const Service = require("../models/service");
const Category = require("../models/category");

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
      const partnerResult = validateObjectId(req.query.partner_id, 'partner')
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
      filter.name = { $regex: new RegExp(req.query.name, 'i') }; // Case-insensitive match
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
      { path: "service_id" },
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


    const category = await Category.findById(records[0].category_id);
    category.helpers = category.helpers + 1;
    await category.save();

    for (const record of records) {
      const key = `${record.partner_id}-${record.service_id}`;

      // If service_id & partner_id combination does not exist, add to insert list
      if (!existingServiceMap.has(key)) {
        const service = await Service.findById(record.service_id);
        service.helpers = service.helpers + 1;
        await service.save();

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
      { path: "service_id" },
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



module.exports = { getAll, create, updateStatus, deleteState, getDropDown };