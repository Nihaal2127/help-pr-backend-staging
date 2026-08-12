const { body, param, query } = require("express-validator");
const { DISPUTE_STATUSES } = require("../../../enum/dispute_status_enum");
const { fieldLabel } = require("../../../utils/field_labels");

const raiseDisputeValidator = [
  body("order_id").isMongoId().withMessage(`${fieldLabel("order_id")} must be valid.`),
  body("reason").optional().isString().isLength({ max: 500 }).withMessage(`${fieldLabel("reason")} is too long.`),
  body("description")
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage(`${fieldLabel("description")} is too long.`),
];

const disputeIdParamValidator = [
  param("disputeId").isMongoId().withMessage(`${fieldLabel("disputeId")} must be valid.`),
];

const listDisputesQueryValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage(`${fieldLabel("page")} must be >= 1.`),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage(`${fieldLabel("limit")} must be 1-100.`),
];

const startSupportChatValidator = [
  body("employee_id").optional().isMongoId().withMessage(`${fieldLabel("employee_id")} must be valid.`),
  body("franchise_id").optional().isMongoId().withMessage(`${fieldLabel("franchise_id")} must be valid.`),
  body("initial_message").optional().isString().withMessage(`${fieldLabel("initial_message")} must be string.`),
];

module.exports = {
  raiseDisputeValidator,
  disputeIdParamValidator,
  listDisputesQueryValidator,
  startSupportChatValidator,
};
