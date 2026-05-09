const mongoose = require("mongoose");
const Message = require("../models/message.model");
const ReadTracking = require("../models/readTracking.model");
const ChatError = require("../utils/chatError");

const markAsRead = async (userId, chatId) => {
  if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(chatId)) {
    throw new ChatError("userId and chatId must be valid.", 400, "INVALID_ID");
  }

  const tracking = await ReadTracking.findOneAndUpdate(
    { userId, chatId },
    { $set: { lastReadAt: new Date() } },
    { upsert: true, new: true }
  );

  return tracking;
};

const getUnreadCount = async (userId, chatId) => {
  if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(chatId)) {
    throw new ChatError("userId and chatId must be valid.", 400, "INVALID_ID");
  }

  const tracking = await ReadTracking.findOne({ userId, chatId });
  const lastReadAt = tracking?.lastReadAt || new Date(0);

  const unreadCount = await Message.countDocuments({
    chatId,
    createdAt: { $gt: lastReadAt },
  });

  return { unreadCount, lastReadAt };
};

module.exports = {
  markAsRead,
  getUnreadCount,
};
