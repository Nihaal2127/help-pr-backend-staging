const mongoose = require("mongoose");
const City = require('../models/city');
const State = require('../models/state');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { validationResult } = require('express-validator');
const { parseBoolean } = require('../utils/parser');
const state = require('../models/state');

const getAll = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const is_active = req.query.is_active !== undefined ? parseBoolean(req.query.is_active) : null;

    const filter = {
      deleted_at: null,
      ...(req.query.is_active && { is_active: is_active }),
    };
    if (req.query.name) {
      filter.name = { $regex: new RegExp(req.query.name, "i") }; // Case-insensitive match
    }
    if (req.query.state_name) {
      filter.state_name = { $regex: new RegExp(req.query.state_name, "i") }; // Case-insensitive match
    }
    if (req.query.state_id) {
      if (mongoose.Types.ObjectId.isValid(req.query.state_id)) {
        filter.state_id = new mongoose.Types.ObjectId(req.query.state_id);
      } else {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "Invalid state id format.",
        });
      }
    }
    
    const sort = { created_at: req.query.sort !== undefined ? parseInt(req.query.sort) : -1 };

    const { data: cities, totalCount, totalPages, currentPage } = await applyPagination(
      City,
      filter,
      page,
      limit,
      sort
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: "City list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: cities,
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
    const { name, is_active, state_id,city_service_price } = req.body;

    const existingCity = await City.findOne({
      $or: [
        { name },
      ],
      deleted_at: null
    });

    if (existingCity) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'City name already exists.',
      });
    }

    const state = await State.findOne({ _id: state_id, deleted_at: null })

    const newCity = new City({
      name,
      city_service_price,
      state_name: state.name,
      is_active,
      state_id,
    });

    const savedCity = await newCity.save();
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'City created successfully.',
      record: savedCity,
    });
  } catch (error) {
    console.error('Error creating City:', error.message);
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
      message: errors.array()
    });
  }
  const { id } = req.params;
  const updateData = req.body;

  try {

    const city = await City.findById(id);

    if (!city) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    if (req.body.name) {
      const name = req.body.name
      const existingCity = await City.findOne({
        $or: [
          { name },
        ],
        deleted_at: null,
        _id: { $ne: id },
      });

      if (existingCity) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: 'City name already exists.',
        });
      }
    }
    if (req.body.state_id) {
      const state_id = req.body.state_id;
      const state = await State.findOne({ _id: state_id, deleted_at: null });
      city.state_name = state.name;
    }
    Object.keys(updateData).forEach((key) => {
      city[key] = updateData[key];
    });


    const updatedCity = await city.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'City updated successfully',
      record: updatedCity,
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
    const city = await City.findById(id);

    if (!city) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    res.status(200).json({
      success: true,
      status: 201,
      message: 'City fetched successfully',
      record: city,
    });
  } catch (error) {
    console.error('Error fetching City:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const deleteCity = async (req, res) => {
  const { id } = req.params;

  try {

    const city = await City.findById(id);

    if (!city) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }


    if (city.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'City is already deleted'
      });
    }


    city.deleted_at = new Date();


    await city.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'City deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting City:', error);
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


    const names = records.map(record => record.name);
    const existingRecords = await City.find({ name: { $in: names }, deleted_at: null }).select('name');

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

    for (const record of records) {
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
    const result = await City.insertMany(enrichedRecords, { ordered: false });

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
const getDropDownOld = async (req, res) => {

  try {

    const filter = {
      deleted_at: null,
      is_active: true,
    };
    const sort = { created_at: -1 };
    if (req.query.state_id) {
      if (mongoose.Types.ObjectId.isValid(req.query.state_id)) {
        filter.state_id = new mongoose.Types.ObjectId(req.query.state_id);
      } else {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "Invalid state id format.",
        });
      }
    }
    const { data: cities, } = await applyDropDownFilter(
      City,
      filter,
      sort
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: "City list fetched successfully.",
      records: cities,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
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

    if (req.query.state_id) {
      let stateIds = req.query.state_id;

      if (!Array.isArray(stateIds)) {
        stateIds = stateIds.split(','); // Convert comma-separated string to array
      }

      const validStateIds = stateIds
        .filter(id => mongoose.Types.ObjectId.isValid(id)) // Validate each state_id
        .map(id => new mongoose.Types.ObjectId(id));
      
      if (validStateIds.length === 0) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "Invalid state id format.",
        });
      }

      filter.state_id = { $in: validStateIds };
    }

    const { data: cities } = await applyDropDownFilter(City, filter, sort);

    res.status(200).json({
      success: true,
      status: 200,
      message: "City list fetched successfully.",
      records: cities,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = { getAll, create, update, getById, deleteCity, importRecords, getDropDown };