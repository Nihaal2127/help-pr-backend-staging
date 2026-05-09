const { sendPushNotification } = require("../service/firebase/push_service");

const send_notification = async (req, res) => {

    const { deviceToken, title, body, data } = req.body;

    if (!deviceToken || !title || !body) {
        return res.status(400).json({ message: "Missing required fields." });
    }

    try {
        const response = await sendPushNotification({ deviceToken, title, body, data });
        res.status(200).json({ message: "Notification sent", response });
    } catch (err) {
        res.status(500).json({ message: "Failed to send notification", error: err.message });
    }
};

module.exports = {send_notification };