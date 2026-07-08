const express = require("express");
const router = express.Router();
const { send_notification } = require("../controllers/notification_test");
const authMiddleware = require("../middleware/auth_middleware");

const isNotificationTestAllowed = () =>
  process.env.ALLOW_NOTIFICATION_TEST === "true" ||
  process.env.NODE_ENV !== "production";

const blockNotificationTestUnlessAllowed = (req, res, next) => {
  if (!isNotificationTestAllowed()) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: "Not found.",
    });
  }
  return next();
};

router.post(
  "/send",
  blockNotificationTestUnlessAllowed,
  authMiddleware,
  send_notification
);

module.exports = router;
