const Tax = require('../models/tax');
const { validationResult } = require('express-validator');

const create = async (req, res) => {
  try {
    const { user_platform_fee,
      partner_platform_fee,
      partner_commision_fee,
      tax_for_customer, } = req.body;


    const newTax = new Tax({
      user_platform_fee,
      partner_platform_fee,
      partner_commision_fee,
      tax_for_customer
    });

    const savedTax = await newTax.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Tax created successfully.',
      record:savedTax,
    });
  } catch (error) {
    console.error('Error creating Tax:', error.message);
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

    const tax = await Tax.findById(id);

    if (!tax) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    Object.keys(updateData).forEach((key) => {
      tax[key] = updateData[key];
    });


    const updatedTax = await tax.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Tax updated successfully',
      Tax: updatedTax,
    });
  } catch (error) {
    console.error('Error updating Tax:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const get = async (req, res) => {
  try {
    const tax = await Tax.findOne({});

    if (!tax) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Tax deetails not found please add tax details.'
      });
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Tax fetched successfully',
      record: tax,
    });
  } catch (error) {
    console.error('Error fetching Tax:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
module.exports = { create, update, get };