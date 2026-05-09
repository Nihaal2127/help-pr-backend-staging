const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth_middleware");
const rateLimiter = require("../middleware/rate_middleware");
const {
  expenseIdRequiredMiddleware,
  validateExpenseIdParam,
  createExpenseManagementMiddleware,
  updateExpenseManagementMiddleware
} = require("../middleware/expense_management_middleware");
const {
  create,
  getAll,
  getById,
  update,
  remove
} = require("../controllers/expense_management_controller");

router.use(rateLimiter);

router.post("/create", authMiddleware, createExpenseManagementMiddleware, create);
router.get("/getAll", authMiddleware, getAll);
router.get("/get/:id", authMiddleware, validateExpenseIdParam, getById);
router.put("/update/:id", authMiddleware, validateExpenseIdParam, updateExpenseManagementMiddleware, update);
router.delete("/delete/:id", authMiddleware, validateExpenseIdParam, remove);

module.exports = router;
