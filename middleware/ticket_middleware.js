const mongoose = require("mongoose");
const { checkObjectIdExists } = require('../validator/id_validator');
const {validateEmail, validatePhoneNumber } = require('../validator/form_validator');
const User = require('../models/user');
const createTicketMiddleware = (req, res, next) => {
  const {
    created_by_id,
    created_by_name,
    email,
    phone_number,
    query,
    contact_type,
  } = req.body;

  const userResult = checkObjectIdExists(User, created_by_id, 'user')
  if (userResult.exists === false) {
    return res.status(409).json({
      success: false,
      status: 409,
      message: userResult.message,
    });
  }
  if (!created_by_name || created_by_name.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Name is required.'
    });
  }
  let emailResult = validateEmail(email)
  if (emailResult.valid === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: emailResult.message
    });
  }
  let phoneNumberResult = validatePhoneNumber(phone_number)
  if (phoneNumberResult.valid === false) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: phoneNumberResult.message
    });
  }
  if (contact_type === undefined) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Status is required.'
    });
  }
  if (!query || query.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Query is required.'
    });
  }
  if (contact_type < 1 || contact_type > 2) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid Contact type.'
    });
  }

  next();
};

const updateTicketMiddleware = (req, res, next) => {
  const {
    resolve_by_id,
    status,
    resolve_status,
  } = req.body;

  const userResult = checkObjectIdExists(User, resolve_by_id, 'employee')
  if (userResult.exists === false) {
    return res.status(409).json({
      success: false,
      status: 409,
      message: userResult.message,
    });
  }
  if (status === undefined) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Status is required.'
    });
  }
  if (status < 1 || status > 2) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid status.'
    });
  }
  
  if (resolve_status === undefined) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Resolve status is required.'
    });
  }
  if (resolve_status < 1 || resolve_status > 3) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Invalid resolve status.'
    });
  }
  next();
};

module.exports = { createTicketMiddleware, updateTicketMiddleware };
