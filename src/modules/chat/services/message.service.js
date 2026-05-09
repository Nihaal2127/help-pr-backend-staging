const mongoose = require("mongoose");
const Chat = require("../models/chat.model");
const Message = require("../models/message.model");
const ChatError = require("../utils/chatError");

const sendMessage = async (payload) => {
  if (!mongoose.Types.ObjectId.isValid(payload.chatId)) {
    throw new ChatError("chatId must be valid.", 400, "INVALID_CHAT_ID");
  }

  const chat = await Chat.findById(payload.chatId);
  if (!chat) {
    throw new ChatError("Chat not found.", 404, "CHAT_NOT_FOUND");
  }

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

  return message;
};

const getMessages = async (chatId, { after, limit = 50 }) => {
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new ChatError("chatId must be valid.", 400, "INVALID_CHAT_ID");
  }

  const query = { chatId };
  if (after) {
    query.createdAt = { $gt: new Date(after) };
  }

  return Message.find(query).sort({ createdAt: 1 }).limit(limit);
};

const createSystemMessage = async (chatId, content) => {
  return sendMessage({
    chatId,
    senderId: new mongoose.Types.ObjectId("000000000000000000000000"),
    type: "system",
    content,
    metadata: { source: "system" },
  });
};

module.exports = {
  sendMessage,
  getMessages,
  createSystemMessage,
};
