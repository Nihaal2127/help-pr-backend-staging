const User = require("../../../../models/user");
const NotificationSettings = require("../../../../models/notification_settings");
const { BACKOFFICE_TYPES } = require("../../../../constants/user_types");
const {
  safeSendPushNotification,
  mapUserTypeToFirebaseTarget,
  getFirebaseDiagnostics,
} = require("../../../../service/firebase/push_service");
const {
  getDeviceTokensForUser,
  removeDeviceTokenByValue,
  isStaleFcmTokenError,
} = require("../../../../services/device_token_service");
const { maskDeviceTokenSuffix } = require("./notificationDeliveryLog.service");

const PUSH_SKIP = {
  SETTINGS_DISABLED: "settings_disabled",
  REMINDER_DISABLED: "reminder_settings_disabled",
  BACKOFFICE_USER: "backoffice_user_no_mobile_push",
  NO_DEVICE_TOKEN: "no_device_token",
  DUPLICATE_DEVICE_TOKEN: "duplicate_device_token",
  UNSUPPORTED_USER_TYPE: "unsupported_user_type",
  FIREBASE_NOT_CONFIGURED: "firebase_not_configured",
  FIREBASE_SEND_FAILED: "firebase_send_failed",
  USER_NOT_FOUND: "user_not_found",
};

const isPushAllowedForUser = async (userId, pushPreference = "update") => {
  try {
    const settings = await NotificationSettings.findOne({ user_id: userId });
    if (!settings) return { allowed: true, skipReason: null };
    if (pushPreference === "reminder") {
      const allowed = settings.is_reminder_allow !== false;
      return {
        allowed,
        skipReason: allowed ? null : PUSH_SKIP.REMINDER_DISABLED,
      };
    }
    const allowed = settings.is_update_allow !== false;
    return {
      allowed,
      skipReason: allowed ? null : PUSH_SKIP.SETTINGS_DISABLED,
    };
  } catch (error) {
    console.error("[notifications] push settings lookup failed:", error.message);
    return { allowed: false, skipReason: PUSH_SKIP.SETTINGS_DISABLED };
  }
};

const sendPushToDevice = async ({
  deviceToken,
  title,
  body,
  data,
  target,
  sentDeviceTokens,
}) => {
  const result = {
    pushSent: false,
    skipReason: null,
    pushError: null,
    pushErrorCode: null,
    firebaseTarget: target || "",
    deviceTokenSuffix: maskDeviceTokenSuffix(deviceToken),
  };

  if (sentDeviceTokens?.has(deviceToken)) {
    return { ...result, skipReason: PUSH_SKIP.DUPLICATE_DEVICE_TOKEN };
  }

  const sendResult = await safeSendPushNotification({
    deviceToken,
    title,
    body,
    data,
    target,
  });

  if (!sendResult?.ok) {
    if (isStaleFcmTokenError(sendResult?.code)) {
      await removeDeviceTokenByValue(deviceToken);
    }
    return {
      ...result,
      skipReason: PUSH_SKIP.FIREBASE_SEND_FAILED,
      pushError: sendResult?.error || "Unknown Firebase error",
      pushErrorCode: sendResult?.code || "",
    };
  }

  sentDeviceTokens?.add(deviceToken);

  return {
    ...result,
    pushSent: true,
    skipReason: null,
    pushError: null,
    pushErrorCode: null,
  };
};

const sendPushForNotification = async ({
  userId,
  title,
  body,
  data,
  pushPreference = "update",
  sentDeviceTokens = null,
}) => {
  const baseResult = {
    pushSent: false,
    skipReason: null,
    pushError: null,
    pushErrorCode: null,
    firebaseTarget: null,
    deviceTokenSuffix: null,
    userType: null,
    devicesAttempted: 0,
    devicesSent: 0,
    deviceResults: [],
  };

  try {
    const { allowed, skipReason: settingsSkip } = await isPushAllowedForUser(
      userId,
      pushPreference
    );
    if (!allowed) {
      return { ...baseResult, skipReason: settingsSkip || PUSH_SKIP.SETTINGS_DISABLED };
    }

    const user = await User.findById(userId).select("type").lean();
    if (!user) {
      return { ...baseResult, skipReason: PUSH_SKIP.USER_NOT_FOUND };
    }

    baseResult.userType = user.type != null ? Number(user.type) : null;

    if (BACKOFFICE_TYPES.has(Number(user.type))) {
      return { ...baseResult, skipReason: PUSH_SKIP.BACKOFFICE_USER };
    }

    const target = mapUserTypeToFirebaseTarget(user?.type);
    baseResult.firebaseTarget = target || "";
    if (!target) {
      return { ...baseResult, skipReason: PUSH_SKIP.UNSUPPORTED_USER_TYPE };
    }

    const diagnostics = getFirebaseDiagnostics();
    if (!diagnostics[target]?.ready) {
      return { ...baseResult, skipReason: PUSH_SKIP.FIREBASE_NOT_CONFIGURED };
    }

    const deviceTokens = await getDeviceTokensForUser(userId);
    baseResult.devicesAttempted = deviceTokens.length;

    if (!deviceTokens.length) {
      return { ...baseResult, skipReason: PUSH_SKIP.NO_DEVICE_TOKEN };
    }

    const deviceResults = [];
    let devicesSent = 0;
    let primarySkipReason = null;

    for (const deviceToken of deviceTokens) {
      const deviceResult = await sendPushToDevice({
        deviceToken,
        title,
        body,
        data,
        target,
        sentDeviceTokens,
      });
      deviceResults.push(deviceResult);
      if (deviceResult.pushSent) {
        devicesSent += 1;
      } else if (!primarySkipReason) {
        primarySkipReason = deviceResult.skipReason;
      }
    }

    const pushSent = devicesSent > 0;
    const lastResult = deviceResults[deviceResults.length - 1] || {};

    return {
      ...baseResult,
      pushSent,
      skipReason: pushSent ? null : primarySkipReason || PUSH_SKIP.FIREBASE_SEND_FAILED,
      pushError: pushSent ? null : lastResult.pushError || null,
      pushErrorCode: pushSent ? null : lastResult.pushErrorCode || null,
      deviceTokenSuffix: lastResult.deviceTokenSuffix || null,
      devicesSent,
      deviceResults,
    };
  } catch (error) {
    console.error(`[notifications] push failed for user ${userId}:`, error.message);
    return {
      ...baseResult,
      skipReason: PUSH_SKIP.FIREBASE_SEND_FAILED,
      pushError: error.message || String(error),
      pushErrorCode: error.code || "",
    };
  }
};

module.exports = {
  sendPushForNotification,
  PUSH_SKIP,
};
