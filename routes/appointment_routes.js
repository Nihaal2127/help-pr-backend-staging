const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth_middleware");
const rateLimiter = require("../middleware/rate_middleware");
const { requireBackoffice } = require("../middleware/role_middleware");
const {
  validateAppointmentIdParam,
  validateOrderIdParam,
  validateCreateAppointmentBody,
  validateUpdateAppointmentBody,
} = require("../middleware/appointment_middleware");
const {
  create,
  getAll,
  getById,
  getByOrder,
  update,
  deleteAppointment,
} = require("../controllers/appointment_controller");

router.use(rateLimiter);
router.use(authMiddleware, requireBackoffice);

router.post("/create", validateCreateAppointmentBody, create);
router.get("/getAll", getAll);
router.get("/getByOrder/:orderId", validateOrderIdParam, getByOrder);
router.get("/get/:id", validateAppointmentIdParam, getById);
router.put(
  "/update/:id",
  validateAppointmentIdParam,
  validateUpdateAppointmentBody,
  update
);
router.delete("/delete/:id", validateAppointmentIdParam, deleteAppointment);

module.exports = router;
