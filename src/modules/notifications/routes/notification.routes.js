const express = require("express");
const authMiddleware = require("../../../../middleware/auth_middleware");
const { requireSuperAdminOrStaff } = require("../../../../middleware/role_middleware");
const {
  listHandler,
  unreadCountHandler,
  markReadHandler,
  markAllReadHandler,
  deliveryLogsHandler,
} = require("../../../../controllers/notification_controller");
const { runRemindersHandler } = require("../../../../controllers/notification_reminder_controller");
const { chatMessageWebhookHandler } = require("../../../../controllers/chat_notification_controller");

const router = express.Router();

router.post("/cron/reminders", runRemindersHandler);
router.post("/webhooks/chat-message", chatMessageWebhookHandler);

router.get("/", authMiddleware, listHandler);
router.get(
  "/delivery-logs",
  authMiddleware,
  requireSuperAdminOrStaff,
  deliveryLogsHandler
);
router.get("/unread-count", authMiddleware, unreadCountHandler);
router.put("/read-all", authMiddleware, markAllReadHandler);
router.put("/:id/read", authMiddleware, markReadHandler);

module.exports = router;
