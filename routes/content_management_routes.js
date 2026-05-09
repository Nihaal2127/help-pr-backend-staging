const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth_middleware");
const rateLimiter = require("../middleware/rate_middleware");
const {
  validateContentIdParam,
  createContentManagementMiddleware,
  updateContentManagementMiddleware
} = require("../middleware/content_management_middleware");
const {
  create,
  getAll,
  getById,
  update,
  remove
} = require("../controllers/content_management_controller");

router.use(rateLimiter);

router.post("/create", authMiddleware, createContentManagementMiddleware, create);
router.get("/getAll", authMiddleware, getAll);
router.get("/get/:id", authMiddleware, validateContentIdParam, getById);
router.put("/update/:id", authMiddleware, validateContentIdParam, updateContentManagementMiddleware, update);
router.delete("/delete/:id", authMiddleware, validateContentIdParam, remove);

module.exports = router;
