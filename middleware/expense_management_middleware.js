const mongoose = require("mongoose");

const isValidObjectIdString = (id) => {
  if (id === undefined || id === null) return false;
  const idStr = String(id).trim();
  if (idStr === "") return false;
  return /^[a-fA-F0-9]{24}$/.test(idStr) && mongoose.Types.ObjectId.isValid(idStr);
};

const expenseIdRequiredMiddleware = (req, res) => {
  return res.status(400).json({
    success: false,
    status: 400,
    message: "Expense id is required."
  });
};

const validateExpenseIdParam = (req, res, next) => {
  const { id } = req.params;
  if (!id || String(id).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Expense id is required."
    });
  }
  const idStr = String(id).trim();
  if (!/^[a-fA-F0-9]{24}$/.test(idStr) || !mongoose.Types.ObjectId.isValid(idStr)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Invalid expense id."
    });
  }
  next();
};

const createExpenseManagementMiddleware = (req, res, next) => {
  const {
    franchise_id,
    category_id,
    subcategory_id,
    expense_name,
    description,
    expense_amount,
    expense_date,
    payment_mode
  } = req.body;

  if (!franchise_id) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Franchise is required."
    });
  }

  if (!category_id) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Category is required."
    });
  }

  if (!subcategory_id) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Sub category is required."
    });
  }

  if (!expense_name || expense_name.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Expense name is required."
    });
  }

  if (!description || description.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Description is required."
    });
  }

  const amountNum = Number(expense_amount);
  if (
    expense_amount === undefined ||
    expense_amount === null ||
    !Number.isFinite(amountNum) ||
    amountNum <= 0
  ) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Valid expense amount is required."
    });
  }

  if (!expense_date || Number.isNaN(new Date(expense_date).getTime())) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Valid expense date is required."
    });
  }

  if (!payment_mode || payment_mode.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Payment mode is required."
    });
  }

  if (!isValidObjectIdString(category_id)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Invalid category id."
    });
  }

  if (!isValidObjectIdString(subcategory_id)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Invalid sub category id."
    });
  }

  if (!isValidObjectIdString(franchise_id)) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Invalid franchise id."
    });
  }

  next();
};

const updateExpenseManagementMiddleware = (req, res, next) => {
  const {
    franchise_id,
    expense_name,
    description,
    expense_amount,
    expense_date,
    payment_mode,
    category_id,
    subcategory_id
  } = req.body;

  if (expense_name !== undefined && expense_name.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Expense name cannot be empty."
    });
  }

  if (description !== undefined && description.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Description cannot be empty."
    });
  }

  if (expense_amount !== undefined) {
    const n = Number(expense_amount);
    if (expense_amount === null || !Number.isFinite(n) || n <= 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Valid expense amount is required."
      });
    }
  }

  if (expense_date !== undefined && Number.isNaN(new Date(expense_date).getTime())) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Valid expense date is required."
    });
  }

  if (payment_mode !== undefined && payment_mode.trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Payment mode cannot be empty."
    });
  }

  if (franchise_id !== undefined && String(franchise_id).trim() === "") {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Franchise cannot be empty."
    });
  }

  if (franchise_id !== undefined && franchise_id !== null && String(franchise_id).trim() !== "") {
    if (!isValidObjectIdString(franchise_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid franchise id."
      });
    }
  }

  if (category_id !== undefined && category_id !== null && String(category_id).trim() !== "") {
    if (!isValidObjectIdString(category_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid category id."
      });
    }
  }

  if (subcategory_id !== undefined && subcategory_id !== null && String(subcategory_id).trim() !== "") {
    if (!isValidObjectIdString(subcategory_id)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Invalid sub category id."
      });
    }
  }

  next();
};

module.exports = {
  expenseIdRequiredMiddleware,
  validateExpenseIdParam,
  createExpenseManagementMiddleware,
  updateExpenseManagementMiddleware
};
