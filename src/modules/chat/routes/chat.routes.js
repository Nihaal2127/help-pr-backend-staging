const express = require("express");
const authMiddleware = require("../../../../middleware/auth_middleware");
const chatController = require("../controllers/chat.controller");
const validateRequest = require("../validators/validateRequest");
const {
  createChatValidator,
  transferChatValidator,
  convertChatValidator,
  membersValidator,
  removeMemberValidator,
} = require("../validators/chat.validator");

const router = express.Router();

router.post("/", authMiddleware, createChatValidator, validateRequest, chatController.createChat);
router.get("/", authMiddleware, chatController.getChats);
router.get("/:id", authMiddleware, chatController.getChat);
router.post("/:id/transfer", authMiddleware, transferChatValidator, validateRequest, chatController.transferChat);
router.post("/:id/convert", authMiddleware, convertChatValidator, validateRequest, chatController.convertChat);
router.post("/:id/members", authMiddleware, membersValidator, validateRequest, chatController.addMembers);
router.delete(
  "/:id/members/:userId",
  authMiddleware,
  removeMemberValidator,
  validateRequest,
  chatController.removeMember
);

module.exports = router;
