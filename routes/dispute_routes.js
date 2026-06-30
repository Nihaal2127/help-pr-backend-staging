const express = require("express");
const authMiddleware = require("../middleware/auth_middleware");
const { getAll, getById, updateStatus } = require("../controllers/dispute_controller");
const {
  updateDisputeStatusValidator,
  disputeIdValidator,
  listDisputesQueryValidator,
} = require("../middleware/dispute_middleware");
const validateRequest = require("../utils/validateRequest");

const router = express.Router();

router.get(
  "/getAll",
  authMiddleware,
  listDisputesQueryValidator,
  validateRequest,
  getAll
);
router.get(
  "/get/:id",
  authMiddleware,
  disputeIdValidator,
  validateRequest,
  getById
);
router.put(
  "/update/:id",
  authMiddleware,
  updateDisputeStatusValidator,
  validateRequest,
  updateStatus
);

module.exports = router;
