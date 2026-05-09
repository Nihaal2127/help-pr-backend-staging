const mongoose = require("mongoose");
const createUserMiddleware = (req, res, next) => {
  const {
    partner_id,
    document_id,
    document_images,
  } = req.body;
  if (!partner_id || partner_id.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Partner id is requiered.'
    });
  } else {
    if (!mongoose.Types.ObjectId.isValid(partner_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid partner id.",
      });
    }
  }
  if (!document_id || document_id.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Created by id is requiered.'
    });
  } else {
    if (!mongoose.Types.ObjectId.isValid(document_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid document id.",
      });
    }
  }
  if (!document_images || !Array.isArray(document_images) || document_images.length === 0) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Document images must be a non-empty array.',
    });
  }
  next();
};

const updateUserMiddleware = (req, res, next) => {
  const {
    partner_id,
    document_id,
    document_images,
  } = req.body;

  if (partner_id !== undefined && partner_id.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Partner id is requiered.'
    });
  } else {
    if (!mongoose.Types.ObjectId.isValid(partner_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid partner id.",
      });
    }
  }
  if (!document_id !== undefined && document_id.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Document id is requiered.'
    });
  } else {
    if (!mongoose.Types.ObjectId.isValid(document_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid document id.",
      });
    }
  }
  if (document_images !== undefined && !Array.isArray(document_images) || document_images.length === 0) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Document images must be a non-empty array.',
    });
  }

  next();
};
module.exports = { createUserMiddleware, updateUserMiddleware };
