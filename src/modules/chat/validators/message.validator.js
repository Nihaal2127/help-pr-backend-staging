const { body, query } = require("express-validator");

const sendMessageValidator = [
  body("chatId").isMongoId().withMessage("chatId must be valid."),
  body("type")
    .optional()
    .isIn(["text", "image", "file", "system"])
    .withMessage("type must be text, image, file, or system."),
  body("content").optional().isString().withMessage("content must be string."),
  body("fileUrl").optional().isString().withMessage("fileUrl must be string."),
  body("metadata").optional().isObject().withMessage("metadata must be object."),
];

const getMessagesValidator = [
  query("chatId").isMongoId().withMessage("chatId must be valid."),
  query("after").optional().isISO8601().withMessage("after must be a valid date."),
  query("limit").optional().isInt({ min: 1, max: 200 }).withMessage("limit must be 1-200."),
];

module.exports = {
  sendMessageValidator,
  getMessagesValidator,
};
