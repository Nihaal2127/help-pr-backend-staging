const express = require("express");
const userAuthMiddleware = require("../../../middleware/mobile/user/user_auth_middleware");
const validateRequest = require("../../../utils/validateRequest");
const {
  raiseDisputeValidator,
  disputeIdParamValidator,
  listDisputesQueryValidator,
  startSupportChatValidator,
} = require("../../../middleware/mobile/user/chat_dispute_middleware");
const {
  raiseDisputeHandler,
  listDisputesHandler,
  getDisputeHandler,
  startSupportChatHandler,
} = require("../../../controllers/mobile/user/chat_dispute_controller");

const router = express.Router();

router.post(
  "/disputes",
  userAuthMiddleware,
  raiseDisputeValidator,
  validateRequest,
  raiseDisputeHandler
);
router.get(
  "/disputes",
  userAuthMiddleware,
  listDisputesQueryValidator,
  validateRequest,
  listDisputesHandler
);
router.get(
  "/disputes/:disputeId",
  userAuthMiddleware,
  disputeIdParamValidator,
  validateRequest,
  getDisputeHandler
);
router.post(
  "/chats/support",
  userAuthMiddleware,
  startSupportChatValidator,
  validateRequest,
  startSupportChatHandler
);

module.exports = router;
