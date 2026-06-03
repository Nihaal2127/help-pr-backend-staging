const mongoose = require("mongoose");
const Message = require("../models/message.model");
const ReadTracking = require("../models/readTracking.model");
const { assertChatAccess } = require("../utils/chatAccess");

const markAsRead = async (userId, chatId, userType) => {
  await assertChatAccess(chatId, userId, userType);

  const tracking = await ReadTracking.findOneAndUpdate(
    { userId, chatId },
    { $set: { lastReadAt: new Date() } },
    { upsert: true, new: true }
  );

  return tracking;
};

const getUnreadCount = async (userId, chatId, userType) => {
  await assertChatAccess(chatId, userId, userType);

  const tracking = await ReadTracking.findOne({ userId, chatId });
  const lastReadAt = tracking?.lastReadAt || new Date(0);

  const unreadCount = await Message.countDocuments({
    chatId,
    senderId: { $ne: new mongoose.Types.ObjectId(userId) },
    type: { $ne: "system" },
    createdAt: { $gt: lastReadAt },
  });

  return { unreadCount, lastReadAt };
};

module.exports = {
  markAsRead,
  getUnreadCount,
};
