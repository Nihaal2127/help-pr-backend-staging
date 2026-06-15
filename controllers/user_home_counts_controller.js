const UserHomeCounts = require('../models/user_home_counts');
const { validationResult } = require('express-validator');

const METRIC_FIELDS = [
  'total_distance_travelled',
  'served',
  'consulted',
  'captured',
];

const pickMetricFields = (body) => {
  const data = {};
  METRIC_FIELDS.forEach((field) => {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  });
  return data;
};

const create = async (req, res) => {
  try {
    const existing = await UserHomeCounts.findOne({});
    if (existing) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'Home metrics already exist. Use update instead.',
        record: existing,
      });
    }

    const metricData = pickMetricFields(req.body);
    const newUserHomeCounts = new UserHomeCounts(metricData);
    const savedUserHomeCounts = await newUserHomeCounts.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'User home counts created successfully.',
      record: savedUserHomeCounts,
    });
  } catch (error) {
    console.error('Error creating User home counts:', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const update = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array(),
    });
  }

  const { id } = req.params;
  const updateData = pickMetricFields(req.body);

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'At least one metric field is required.',
    });
  }

  try {
    const userHomeCounts = await UserHomeCounts.findById(id);

    if (!userHomeCounts) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found.',
      });
    }

    Object.keys(updateData).forEach((key) => {
      userHomeCounts[key] = updateData[key];
    });
    userHomeCounts.updated_at = new Date();

    const updatedUserHomeCounts = await userHomeCounts.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'User home counts updated successfully.',
      record: updatedUserHomeCounts,
    });
  } catch (error) {
    console.error('Error updating User home counts:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const get = async (req, res) => {
  try {
    const userHomeCounts = await UserHomeCounts.findOne({});

    if (!userHomeCounts) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found.',
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'User home counts fetched successfully.',
      record: userHomeCounts,
    });
  } catch (error) {
    console.error('Error fetching User home counts:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = { create, update, get };
