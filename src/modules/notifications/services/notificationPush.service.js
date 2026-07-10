const User = require("../../../../models/user");
const NotificationSettings = require("../../../../models/notification_settings");
const { BACKOFFICE_TYPES } = require("../../../../constants/user_types");
const { safeSendPushNotification, mapUserTypeToFirebaseTarget } = require("../../../../service/firebase/push_service");

const isPushAllowedForUser = async (userId, pushPreference = "update") => {
  try {
    const settings = await NotificationSettings.findOne({ user_id: userId });
    if (!settings) return true;
    if (pushPreference === "reminder") {
      return settings.is_reminder_allow !== false;
    }
    return settings.is_update_allow !== false;
  } catch (error) {
    console.error("[notifications] push settings lookup failed:", error.message);
    return false;
  }
};

const sendPushForNotification = async ({
  userId,
  title,
  body,
  data,
  pushPreference = "update",
  sentDeviceTokens = null,
}) => {
  try {
    const allowed = await isPushAllowedForUser(userId, pushPreference);
    if (!allowed) return false;

    const user = await User.findById(userId).select("device_token type").lean();
    if (user && BACKOFFICE_TYPES.has(Number(user.type))) {
      return false;
    }
    const deviceToken = user?.device_token ? String(user.device_token).trim() : "";
    if (!deviceToken) return false;

    if (sentDeviceTokens) {
      if (sentDeviceTokens.has(deviceToken)) return false;
      sentDeviceTokens.add(deviceToken);
    }

    const target = mapUserTypeToFirebaseTarget(user?.type);
    if (!target) return false;

    await safeSendPushNotification({
      deviceToken,
      title,
      body,
      data,
      target: mapUserTypeToFirebaseTarget(user.type),
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
