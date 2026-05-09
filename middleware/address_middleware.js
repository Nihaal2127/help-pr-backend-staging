const mongoose = require("mongoose");
const User = require("../models/user");
const State = require("../models/state");
const City = require("../models/city");
const {checkObjectIdExists} = require("../validator/id_validator");
const {validatePhoneNumber} = require("../validator/form_validator");
const createAddressMiddleware = (req, res, next) => {
  const {
    user_id,
    contact_name,
    contact_number,
    address,
    landmark,
    area,
    state_id,
    city_id,
    pincode,
  } = req.body;



  const userIdResult = checkObjectIdExists(User,user_id,'user');
  if (userIdResult.exists === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: userIdResult.message
    });
  }

  if (!contact_name || contact_name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Contact name is required.'
    });
  }

  const contactNumberResult = validatePhoneNumber(contact_number);
  if (contactNumberResult.valid === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: contactNumberResult.message
    });
  }
  if (!address || address.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Address is required.'
    });
  }
  if (!landmark || landmark.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Landmark is required.'
    });
  }
  if (!area || area.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Area is required.'
    });
  }
  if (!pincode || pincode.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Pincode is required.'
    });
  }
  const stateIdResult = checkObjectIdExists(State,state_id,'state');
  if (stateIdResult.exists === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: stateIdResult.message
    });
  }
  const cityIdResult = checkObjectIdExists(City,city_id,'city');
  if (cityIdResult.exists === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: cityIdResult.message
    });
  }
  next();
};

const updateAddressMiddleware = (req, res, next) => {
  const {
    user_id,
    contact_name,
    contact_number,
    address,
    landmark,
    area,
    city_id,
    pincode,
  } = req.body;

  const userIdResult = checkObjectIdExists(User,user_id,'user');
  if (user_id !== undefined && userIdResult.exists === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: userIdResult.message
    });
  }

  if (!contact_name !== undefined && contact_name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Contact name is required.'
    });
  }

  const contactNumberResult = validatePhoneNumber(contact_number);
  if (contact_number !== undefined && contactNumberResult.valid === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: contactNumberResult.message
    });
  }
  if (!address !== undefined && address.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Address is required.'
    });
  }
  if (!landmark !== undefined && landmark.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Landmark is required.'
    });
  }
  if (!area !== undefined && area.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Area is required.'
    });
  }
  if (!pincode !== undefined && pincode.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Pincode is required.'
    });
  }
  const stateIdResult = checkObjectIdExists(State,state_id,'state');
  if (state_id !== undefined && stateIdResult.exists === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: stateIdResult.message
    });
  }
  const cityIdResult = checkObjectIdExists(City,city_id,'city');
  if (city_id !== undefined && cityIdResult.exists === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: cityIdResult.message
    });
  }
  next();
};
module.exports = { createAddressMiddleware, updateAddressMiddleware };
