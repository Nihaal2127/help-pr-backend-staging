const express = require("express");
const userAuthMiddleware = require("../../../../middleware/mobile/user/user_auth_middleware");
const partnerAuthMiddleware = require("../../../../middleware/mobile/partner/partner_auth_middleware");
const {
  listHandler,
  unreadCountHandler,
  markReadHandler,
  markAllReadHandler,
} = require("../../../../controllers/notification_controller");

const createMobileRouter = (authMiddleware) => {
  const router = express.Router();
  router.get("/", authMiddleware, listHandler);
  router.get("/unread-count", authMiddleware, unreadCountHandler);
  router.put("/read-all", authMiddleware, markAllReadHandler);
  router.put("/:id/read", authMiddleware, markReadHandler);
  return router;
};

const userNotificationRoutes = createMobileRouter(userAuthMiddleware);
const partnerNotificationRoutes = createMobileRouter(partnerAuthMiddleware);

module.exports = {
  userNotificationRoutes,
  partnerNotificationRoutes,
};
