const State = require('../models/state');
const { applyPagination, applyDropDownFilter } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');
const { validationResult } = require('express-validator');

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameExistsRegex = (trimmedName) => ({
  deleted_at: null,
  name: new RegExp(`^${escapeRegExp(trimmedName)}$`, 'i'),
});

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

    const nameSearch = (req.query.name || req.query.keyword || '').toString().trim();
    if (nameSearch) {
      filter.name = { $regex: new RegExp(nameSearch, 'i') };
    }

    const sortByParam = (req.query.sort_by || '').toString().toLowerCase();
    const legacySort = req.query.sort !== undefined ? parseInt(req.query.sort, 10) : null;
    const sortOrder =
      req.query.sort_order !== undefined
        ? (parseInt(req.query.sort_order, 10) === -1 ? -1 : 1)
        : legacySort !== null && !Number.isNaN(legacySort)
          ? legacySort
          : -1;
    const sort =
      sortByParam === 'name'
        ? { name: sortOrder }
        : { created_at: sortOrder };
    
    const { data: states, totalCount, totalPages, currentPage } = await applyPagination(
      State,
      filter,
      page,
      limit,
      sort,
      {},
      [],
      {}
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: "State list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: states,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};
const create = async (req, res) => {
  try {
    const { name, is_active } = req.body;
    const trimmedName = String(name).trim();
    if (!trimmedName) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'State name is requiered.',
      });
    }

    const existingState = await State.findOne(nameExistsRegex(trimmedName));

    if (existingState) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'State name already exists.',
      });
    }
    const newState = new State({
      name: trimmedName,
      is_active,
    });

    const savedState = await newState.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'State created successfully.',
      savedState,
    });
  } catch (error) {
    console.error('Error creating State:', error.message);
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

    const state = await State.findById(id);

    if (!state) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    if (req.body.name !== undefined) {
      const trimmedName = String(req.body.name).trim();
      if (!trimmedName) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'State name is requiered.',
        });
      }
      const existingState = await State.findOne({
        ...nameExistsRegex(trimmedName),
        _id: { $ne: id },
      });

      if (existingState) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: 'State name already exists.',
        });
      }
      updateData.name = trimmedName;
    }

    Object.keys(updateData).forEach((key) => {
      state[key] = updateData[key];
    });


    const updatedPromo = await state.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'State updated successfully',
      State: updatedPromo,
    });
  } catch (error) {
    console.error('Error updating State:', error);
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
    const state = await State.findById(id);

    if (!state) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    res.status(200).json({
      success: true,
      status: 201,
      message: 'State fetched successfully',
      record: state,
    });
  } catch (error) {
    console.error('Error fetching State:', error);
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

    const state = await State.findById(id);

    if (!state) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }


    if (state.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'State is already deleted'
      });
    }


    state.deleted_at = new Date();


    await state.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'State deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting State:', error);
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
      name: String(record.name || '').trim(),
    }));
    for (const r of normalizedRows) {
      if (!r.name) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Each record must include a non-empty state name.',
        });
      }
    }
    const seenNorm = new Set();
    for (const r of normalizedRows) {
      const k = r.name.toLowerCase();
      if (seenNorm.has(k)) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: 'Duplicate state names in import file (case-insensitive).',
        });
      }
      seenNorm.add(k);
    }
    const uniqueNames = [...new Set(normalizedRows.map((r) => r.name))];
    const existingRecords = await State.find({
      deleted_at: null,
      $or: uniqueNames.map((n) => ({ name: new RegExp(`^${escapeRegExp(n)}$`, 'i') })),
    }).select('name');

    if (existingRecords.length > 0) {
      const duplicateNames = existingRecords.map(record => record.name).join('\n');
      return res.status(409).json({
        success: false,
        status: 409,
        message: `Duplicate records found. No records were added.\nDuplicate records:\n${duplicateNames}`
      });
    }
    const result = await State.insertMany(normalizedRows, { ordered: false });
    res.status(200).json({
      success: true,
      status: 200,
      message: `${result.length} records added successfully!`,
      records: result
    });
  } catch (error) {
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

    const { data: states, } = await applyDropDownFilter(
      State,
      filter,
      sort
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: "State list fetched successfully.",
      records: states,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};
module.exports = { getAll, create, update, getById, deleteState, importRecords, getDropDown };