const express = require("express");
const authMiddleware = require("../../../../middleware/auth_middleware");
const messageController = require("../controllers/message.controller");
const validateRequest = require("../validators/validateRequest");
const { sendMessageValidator, getMessagesValidator } = require("../validators/message.validator");

const router = express.Router();

router.post("/messages", authMiddleware, sendMessageValidator, validateRequest, messageController.sendMessage);
router.get("/messages", authMiddleware, getMessagesValidator, validateRequest, messageController.getMessages);

module.exports = router;
