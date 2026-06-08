const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const serviceAccountPath = path.join(__dirname, "../../resources/adminsdk.json");
let isFirebaseReady = false;

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  isFirebaseReady = true;
} else {
  console.warn(
    "Firebase service account file not found. Push notifications are disabled."
  );
}

  const sendPushNotification = async ({ deviceToken, title, body, data = {} }) => {
    if (!isFirebaseReady) {
      throw new Error(
        "Firebase is not configured. Missing resources/adminsdk.json service account file."
      );
    }

    const message = {
      token: deviceToken, // FCM token from Android/iOS app
      notification: {
        title,
        body
      },
      data: {
        "click_action": "FLUTTER_NOTIFICATION_CLICK",
        ...data, // custom key-value pairs, all string type
      },
      android: {
        priority: "high",
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            contentAvailable: true,
          },
        },
      },
    };
  
    try {
      const response = await admin.messaging().send(message);
      console.log("Successfully sent message:", response);
      return response;
    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  };
  
  const safeSendPushNotification = async (payload) => {
    try {
      return await sendPushNotification(payload);
    } catch (error) {
      console.error("Push notification failed:", error.message || error);
      return null;
    }
  };

  module.exports = { sendPushNotification, safeSendPushNotification };