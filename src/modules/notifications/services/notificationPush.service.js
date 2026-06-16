const User = require("../../../../models/user");
const NotificationSettings = require("../../../../models/notification_settings");
const { safeSendPushNotification } = require("../../../../service/firebase/push_service");

const isPushAllowedForUser = async (userId) => {
  try {
    const settings = await NotificationSettings.findOne({ user_id: userId });
    if (!settings) return true;
    return settings.is_update_allow !== false;
  } catch (error) {
    console.error("[notifications] push settings lookup failed:", error.message);
    return false;
  }
};

const sendPushForNotification = async ({ userId, title, body, data }) => {
  try {
    const allowed = await isPushAllowedForUser(userId);
    if (!allowed) return false;

    const user = await User.findById(userId).select("device_token").lean();
    const deviceToken = user?.device_token;
    if (!deviceToken) return false;

    await safeSendPushNotification({
      deviceToken,
      title,
      body,
      data,
    });
    return true;
  } catch (error) {
    console.error(`[notifications] push failed for user ${userId}:`, error.message);
    return false;
  }
};

module.exports = {
  sendPushForNotification,
};
