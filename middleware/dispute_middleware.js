const { body, param, query } = require("express-validator");
const { DISPUTE_STATUSES } = require("../enum/dispute_status_enum");

const raiseDisputeValidator = [
  body("order_id").isMongoId().withMessage("order_id must be valid."),
  body("reason").optional().isString().isLength({ max: 500 }).withMessage("reason is too long."),
  body(
    "description"
  )
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage("description is too long."),
];

const updateDisputeStatusValidator = [
  param("id").isMongoId().withMessage("Invalid dispute id."),
  body("status")
    .isIn(DISPUTE_STATUSES)
    .withMessage(`status must be one of: ${DISPUTE_STATUSES.join(", ")}.`),
];

const disputeIdValidator = [
  param("id").isMongoId().withMessage("Invalid dispute id."),
];

const listDisputesQueryValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("page must be >= 1."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit must be 1-100."),
  query("status")
    .optional()
    .isIn(DISPUTE_STATUSES)
    .withMessage(`status must be one of: ${DISPUTE_STATUSES.join(", ")}.`),
  query("order_id").optional().isMongoId().withMessage("order_id must be valid."),
  query("franchise_id").optional().isMongoId().withMessage("franchise_id must be valid."),
];

module.exports = {
  raiseDisputeValidator,
  updateDisputeStatusValidator,
  disputeIdValidator,
  listDisputesQueryValidator,
};
