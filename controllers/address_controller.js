const mongoose = require("mongoose");
const Address = require('../models/address');
const City = require('../models/city');
const User = require('../models/user');
const { validationResult } = require('express-validator');

const { applyPagination } = require('../utils/pagination');
const { checkObjectIdExists } = require('../validator/id_validator');
const { softDeleteAddressRecord } = require('../services/address_lifecycle_service');


const getAll = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const filter = {
      deleted_at: null,
    };
    const user_id = req.query.user_id;
    if (!user_id || user_id === undefined || user_id.trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Please Enter user id.',
      });
    }
//test
    const userResult = await checkObjectIdExists(User, user_id, 'user');
    if (userResult.exists === false) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: userResult.message,
      });
    }
    filter.user_id = new mongoose.Types.ObjectId(user_id);

    if (req.query.city_id) {
      const categoryResult = await checkObjectIdExists(City, req.query.city_id, 'city');
      if (categoryResult.exists === false) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: categoryResult.message,
        });
      }
      filter.city_id = new mongoose.Types.ObjectId(req.query.city_id);
    }
    const sort = { created_at: -1 };

    const projection = { password: 0, auth_token: 0 };
    const { data: addreses, totalCount, totalPages, currentPage } = await applyPagination(
      Address,
      filter,
      page,
      limit,
      sort,
      projection,
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Addreses list fetched successfully.',
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: addreses,
    });
  } catch (err) {
    console.log("Error is ", err.message);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const create = async (req, res) => {
  try {
    const {
      user_id,
      contact_name,
      contact_number,
      address,
      landmark,
      area,
      area_id,
      state_id,
      city_id,
      pincode,
      city,
      state,
    } = req.body;

    const newAddress = new Address({
      user_id,
      contact_name,
      contact_number,
      address,
      landmark,
      area,
      area_id,
      state_id,
      city_id,
      pincode,
      city,
      state,
    });
    await newAddress.save();

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Addreses created successfully.',
    });
  } catch (error) {
    console.error('Error creating Address:', error.message);
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
    const addreses = await Address.findById(id);

    if (!addreses) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Addreses not found'
      });
    }


    Object.keys(updateData).forEach((key) => {
      addreses[key] = updateData[key];
    });

    const updatedAddreses = await addreses.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Addreses updated successfully',
      record: updatedAddreses,
    });
  } catch (error) {
    console.error('Error updating Address:', error);
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
    const address = await Address.findById(id);

    if (!address) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Addreses not found'
      });
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Addreses fetched successfully',
      record: address,
    });
  } catch (error) {
    console.error('Error fetching Address:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const deleteAddress = async (req, res) => {
  const { id } = req.params;

  try {
    const address = await Address.findById(id);

    if (!address) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Addreses not found'
      });
    }

    const deleteResult = await softDeleteAddressRecord(address);
    if (!deleteResult.ok) {
      const message =
        deleteResult.status === 400
          ? 'Addreses is already deleted'
          : deleteResult.message;
      return res.status(deleteResult.status).json({
        success: false,
        status: deleteResult.status,
        message,
      });
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Addreses deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Address:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

module.exports = { getAll, create, update, getById, deleteAddress };
