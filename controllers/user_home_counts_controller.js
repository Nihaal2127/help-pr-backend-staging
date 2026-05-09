const UserHomeCounts = require('../models/user_home_counts');
const { validationResult } = require('express-validator');

const create = async (req, res) => {
  try {
    const { total_distance_travelled,
      served,
      consulted,
      captured, } = req.body;


    const newUserHomeCounts = new UserHomeCounts({
      total_distance_travelled,
      served,
      consulted,
      captured
    });

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

    const userHomeCounts = await UserHomeCounts.findById(id);

    if (!userHomeCounts) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    Object.keys(updateData).forEach((key) => {
      userHomeCounts[key] = updateData[key];
    });


    const updatedUserHomeCounts = await userHomeCounts.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'User home counts updated successfully',
      record: updatedUserHomeCounts,
    });
  } catch (error) {
    console.error('Error updating User home counts :', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
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
        message: 'No record found'
      });
    }

    res.status(200).json({
      success: true,
      status: 201,
      message: 'User home counts fetched successfully',
      record: userHomeCounts,
    });
  } catch (error) {
    console.error('Error fetching User home counts:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

module.exports = { create, update, get };