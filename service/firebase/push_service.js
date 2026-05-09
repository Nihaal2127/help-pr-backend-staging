const admin = require("firebase-admin");
const serviceAccount = require("../../resources/adminsdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  const sendPushNotification = async ({ deviceToken, title, body, data = {} }) => {
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
  
  module.exports = { sendPushNotification };