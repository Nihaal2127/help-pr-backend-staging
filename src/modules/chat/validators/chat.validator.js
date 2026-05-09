const { body, param } = require("express-validator");

const createChatValidator = [
  body("type")
    .isIn(["support", "order", "quote", "dispute"])
    .withMessage("type must be support, order, quote, or dispute."),
  body("isGroup").optional().isBoolean().withMessage("isGroup must be boolean."),
  body("participants")
    .isArray({ min: 1 })
    .withMessage("participants must be a non-empty array."),
  body("participants.*").isMongoId().withMessage("participant must be valid user id."),
  body("roles").optional().isArray().withMessage("roles must be an array."),
  body("roles.*.userId").optional().isMongoId().withMessage("roles.userId must be valid id."),
  body("roles.*.role")
    .optional()
    .isIn(["customer", "employee", "admin", "partner"])
    .withMessage("Invalid role."),
  body("context.orderId").optional().isMongoId().withMessage("context.orderId must be valid id."),
  body("context.quoteId").optional().isMongoId().withMessage("context.quoteId must be valid id."),
  body("context.disputeId").optional().isMongoId().withMessage("context.disputeId must be valid id."),
  body("assignedTo").optional().isMongoId().withMessage("assignedTo must be valid id."),
];

const transferChatValidator = [
  param("id").isMongoId().withMessage("Invalid chat id."),
  body("newAssignedTo").isMongoId().withMessage("newAssignedTo must be valid id."),
];

const convertChatValidator = [
  param("id").isMongoId().withMessage("Invalid chat id."),
  body("type")
    .isIn(["support", "order", "quote", "dispute"])
    .withMessage("type must be support, order, quote, or dispute."),
  body("context").optional().isObject().withMessage("context must be an object."),
];

const membersValidator = [
  param("id").isMongoId().withMessage("Invalid chat id."),
  body("userIds").isArray({ min: 1 }).withMessage("userIds must be a non-empty array."),
  body("userIds.*").isMongoId().withMessage("userIds must contain valid user ids."),
];

const removeMemberValidator = [
  param("id").isMongoId().withMessage("Invalid chat id."),
  param("userId").isMongoId().withMessage("Invalid user id."),
];

module.exports = {
  createChatValidator,
  transferChatValidator,
  convertChatValidator,
  membersValidator,
  removeMemberValidator,
};
