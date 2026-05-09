const mongoose = require("mongoose");

const validateContentIdParam = (req, res, next) => {
  const { id } = req.params;
  if (!id || String(id).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Content id is required."
    });
  }
  const idStr = String(id).trim();
  if (!/^[a-fA-F0-9]{24}$/.test(idStr) || !mongoose.Types.ObjectId.isValid(idStr)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Invalid content id."
    });
  }
  next();
};

const createContentManagementMiddleware = (req, res, next) => {
  const { title, description } = req.body;

  if (!title || title.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Title is required."
    });
  }

  if (!description || description.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Description is required."
    });
  }

  next();
};

const updateContentManagementMiddleware = (req, res, next) => {
  const { title, description } = req.body;

  if (title !== undefined && title.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Title cannot be empty."
    });
  }

  if (description !== undefined && description.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Description cannot be empty."
    });
  }

  next();
};

module.exports = {
  validateContentIdParam,
  createContentManagementMiddleware,
  updateContentManagementMiddleware
};
