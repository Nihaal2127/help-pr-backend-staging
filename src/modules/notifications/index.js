const notificationRoutes = require("./routes/notification.routes");
const {
  userNotificationRoutes,
  partnerNotificationRoutes,
} = require("./routes/mobileNotification.routes");

module.exports = {
  notificationRoutes,
  userNotificationRoutes,
  partnerNotificationRoutes,
};
