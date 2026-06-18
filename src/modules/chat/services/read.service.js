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

const getUnreadCountsForChats = async (userId, chatIds) => {
  if (!chatIds.length) {
    return new Map();
  }

  const userObjectId = new mongoose.Types.ObjectId(String(userId));
  const objectChatIds = chatIds.map((id) => new mongoose.Types.ObjectId(String(id)));

  const trackings = await ReadTracking.find({
    userId: userObjectId,
    chatId: { $in: objectChatIds },
  }).lean();

  const lastReadByChat = new Map(
    trackings.map((row) => [String(row.chatId), row.lastReadAt || new Date(0)])
  );

  const messages = await Message.find({
    chatId: { $in: objectChatIds },
    senderId: { $ne: userObjectId },
    type: { $ne: "system" },
  })
    .select("chatId createdAt")
    .lean();

  const counts = new Map(objectChatIds.map((id) => [String(id), 0]));

  for (const message of messages) {
    const chatKey = String(message.chatId);
    const lastReadAt = lastReadByChat.get(chatKey) || new Date(0);
    if (message.createdAt > lastReadAt) {
      counts.set(chatKey, (counts.get(chatKey) || 0) + 1);
    }
  }

  return counts;
};

module.exports = {
  markAsRead,
  getUnreadCount,
  getUnreadCountsForChats,
};
