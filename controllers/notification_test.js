const {
  sendPushNotification,
  getFirebaseDiagnostics,
} = require("../service/firebase/push_service");

const send_notification = async (req, res) => {
  const { deviceToken, title, body, data, target } = req.body;

  if (!deviceToken || !title || !body) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  const firebaseTarget = String(target || "customer").trim().toLowerCase();

  try {
    const response = await sendPushNotification({
      deviceToken,
      title,
      body,
      data,
      target: firebaseTarget,
    });
    res.status(200).json({
      message: "Notification sent",
      response,
      firebase: getFirebaseDiagnostics()[firebaseTarget === "partner" ? "partner" : "customer"],
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to send notification",
      error: err.message,
      code: err.code || null,
      details: err.errorInfo || null,
      firebase: getFirebaseDiagnostics(),
      troubleshooting:
        err.code === "messaging/mismatched-credential"
          ? {
              meaning:
                "The FCM token was created by a different Firebase project than the service account on Lambda.",
              customerAppMustMatch: {
                projectId: "helper-user-app",
                senderId: "637181315442",
              },
              fixSteps: [
                "Uninstall the customer app, reinstall the build that uses google-services.json for helper-user-app.",
                "Get a brand-new FCM token from the app (do not reuse an old MongoDB device_token).",
                "Confirm Lambda resources/adminsdk-customer.json has project_id helper-user-app.",
                "Send a test from Firebase Console → helper-user-app → Messaging with the same token.",
              ],
            }
          : null,
    });
  }
};

const firebase_status = async (_req, res) => {
  res.status(200).json({
    message: "Firebase push diagnostics",
    ...getFirebaseDiagnostics(),
  });
};

module.exports = { send_notification, firebase_status };
