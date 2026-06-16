const express = require("express");
const router = express.Router();
const partnerAuthMiddleware = require("../../../middleware/mobile/partner/partner_auth_middleware");
const { requirePartnerAccount } = require("../../../middleware/mobile/partner/quote_middleware");
const {
  validateAppointmentIdParam,
  validateOrderIdParam,
} = require("../../../middleware/mobile/partner/appointment_middleware");
const {
  validateCreateAppointmentBody,
  validateUpdateAppointmentBody,
} = require("../../../middleware/appointment_middleware");
const {
  listHandler,
  getByOrderHandler,
  getByIdHandler,
  createHandler,
  updateHandler,
  deleteHandler,
} = require("../../../controllers/mobile/partner/appointment_controller");

router.use(partnerAuthMiddleware, requirePartnerAccount);

router.get("/", listHandler);
router.get("/order/:orderId", validateOrderIdParam, getByOrderHandler);
router.post("/", validateCreateAppointmentBody, createHandler);
router.get("/:appointmentId", validateAppointmentIdParam, getByIdHandler);
router.put(
  "/:appointmentId",
  validateAppointmentIdParam,
  validateUpdateAppointmentBody,
  updateHandler
);
router.delete("/:appointmentId", validateAppointmentIdParam, deleteHandler);

module.exports = router;
