const User = require("../../../../models/user");
const NotificationSettings = require("../../../../models/notification_settings");
const { sendPushNotification } = require("../../../../service/firebase/push_service");

const SYSTEM_SENDER_ID = "000000000000000000000000";

const getRecipientUserIds = (chat, excludeUserId) => {
  const ids = new Set();
  (chat.participants || []).forEach((id) => ids.add(String(id)));
  if (chat.assignedTo) {
    ids.add(String(chat.assignedTo));
  }
  if (excludeUserId && String(excludeUserId) !== SYSTEM_SENDER_ID) {
    ids.delete(String(excludeUserId));
  }
  return [...ids];
};

const buildPushBody = (message) => {
  if (message.type === "image") return "Sent an image";
  if (message.type === "file") return "Sent a file";
  if (message.type === "system") return (message.content || "").trim() || "Chat update";
  const text = (message.content || "").trim();
  if (!text) return "New message";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

const buildPushData = (chat, message) => {
  const data = {
    type: "Chat",
    chat_id: String(chat._id),
    message_id: String(message._id),
    chat_type: String(chat.type || ""),
  };
  if (chat.context?.orderId) {
    data.order_id = String(chat.context.orderId);
  }
  if (chat.context?.quoteId) {
    data.quote_id = String(chat.context.quoteId);
  }
  return data;
};

const isPushAllowedForUser = async (userId) => {
  const settings = await NotificationSettings.findOne({ user_id: userId });
  if (!settings) return true;
  return settings.is_update_allow !== false;
};

const notifyRecipient = async ({ userId, title, body, data }) => {
  try {
    const allowed = await isPushAllowedForUser(userId);
    if (!allowed) return;

    const user = await User.findById(userId).select("device_token name");
    const deviceToken = user?.device_token;
    if (!deviceToken) return;

    await sendPushNotification({
      deviceToken,
      title,
      body,
      data,
    });
  } catch (error) {
    console.error(`Chat push failed for user ${userId}:`, error.message);
  }
};

/**
 * Sends FCM push to chat participants (and assigned agent), excluding the sender.
 * Failures are logged and do not affect message delivery.
 */
const notifyChatMessagePush = async (chat, message) => {
  const recipientIds = getRecipientUserIds(chat, message.senderId);
  if (recipientIds.length === 0) return;

  let senderName = null;
  if (String(message.senderId) !== SYSTEM_SENDER_ID) {
    const sender = await User.findById(message.senderId).select("name");
    senderName = sender?.name || null;
  }

  const title =
    message.type === "system"
      ? "Chat update"
      : senderName
        ? `Message from ${senderName}`
        : "New chat message";
  const body = buildPushBody(message);
  const data = buildPushData(chat, message);

  await Promise.all(
    recipientIds.map((userId) => notifyRecipient({ userId, title, body, data }))
  );
};

module.exports = {
  notifyChatMessagePush,
  getRecipientUserIds,
};
