const mongoose = require("mongoose");
const Chat = require("../models/chat.model");
const Message = require("../models/message.model");
const ChatError = require("../utils/chatError");
const { assertChatAccess } = require("../utils/chatAccess");
const { notifyChatMessagePush } = require("./chatNotification.service");

const sendMessage = async (payload, userType) => {
  const chat = await assertChatAccess(payload.chatId, payload.senderId, userType);

  const message = await Message.create({
    chatId: payload.chatId,
    senderId: payload.senderId,
    type: payload.type || "text",
    content: payload.content || "",
    fileUrl: payload.fileUrl || "",
    metadata: payload.metadata || null,
  });

  chat.lastMessage = {
    _id: message._id,
    chatId: message.chatId,
    senderId: message.senderId,
    type: message.type,
    content: message.content,
    fileUrl: message.fileUrl,
    metadata: message.metadata,
    createdAt: message.createdAt,
  };
  await chat.save();

  notifyChatMessagePush(chat, message).catch((error) => {
    console.error("Chat push notification error:", error.message);
  });

  return message;
};

const getMessages = async (chatId, userId, userType, { after, limit = 50 }) => {
  await assertChatAccess(chatId, userId, userType);

  const query = { chatId };
  if (after) {
    query.createdAt = { $gt: new Date(after) };
  }

  return Message.find(query).sort({ createdAt: 1 }).limit(limit);
};

const createSystemMessage = async (chatId, content) => {
  const message = await Message.create({
    chatId,
    senderId: new mongoose.Types.ObjectId("000000000000000000000000"),
    type: "system",
    content,
    metadata: { source: "system" },
  });

  const chat = await Chat.findById(chatId);
  if (chat) {
    chat.lastMessage = {
      _id: message._id,
      chatId: message.chatId,
      senderId: message.senderId,
      type: message.type,
      content: message.content,
      fileUrl: message.fileUrl,
      metadata: message.metadata,
      createdAt: message.createdAt,
    };
    await chat.save();
    notifyChatMessagePush(chat, message).catch((error) => {
      console.error("Chat push notification error:", error.message);
    });
  }

  return message;
};

module.exports = {
  sendMessage,
  getMessages,
  createSystemMessage,
};
