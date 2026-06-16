const express = require("express");
const authMiddleware = require("../../../../middleware/auth_middleware");
const {
  listHandler,
  unreadCountHandler,
  markReadHandler,
  markAllReadHandler,
} = require("../../../../controllers/notification_controller");

const router = express.Router();

router.get("/", authMiddleware, listHandler);
router.get("/unread-count", authMiddleware, unreadCountHandler);
router.put("/read-all", authMiddleware, markAllReadHandler);
router.put("/:id/read", authMiddleware, markReadHandler);

module.exports = router;
