const mongoose = require("mongoose");
const Chat = require("../models/chat.model");
const ChatError = require("../utils/chatError");

const ensureObjectId = (value, fieldName) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new ChatError(`${fieldName} must be a valid ObjectId.`, 400, "INVALID_ID");
  }
};

const createChat = async (payload) => {
  const participants = [...new Set((payload.participants || []).map((id) => String(id)))];
  if (participants.length === 0) {
    throw new ChatError("At least one participant is required.", 400, "VALIDATION_ERROR");
  }

  const chat = await Chat.create({
    type: payload.type,
    isGroup: payload.isGroup || participants.length > 2,
    participants,
    roles: payload.roles || [],
    context: payload.context || {},
    assignedTo: payload.assignedTo || null,
    status: payload.status || "open",
    linkedChats: payload.linkedChats || [],
  });

  return chat;
};

const getUserChats = async (userId) => {
  ensureObjectId(userId, "userId");
  return Chat.find({ participants: new mongoose.Types.ObjectId(userId) }).sort({ updatedAt: -1 });
};

const getChatById = async (chatId) => {
  ensureObjectId(chatId, "chatId");
  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new ChatError("Chat not found.", 404, "CHAT_NOT_FOUND");
  }
  return chat;
};

const addParticipants = async (chatId, userIds) => {
  const chat = await getChatById(chatId);
  const newUserIds = [...new Set((userIds || []).map((id) => String(id)))];
  chat.participants = [...new Set([...chat.participants.map((id) => String(id)), ...newUserIds])];
  await chat.save();
  return chat;
};

const removeParticipant = async (chatId, userId) => {
  const chat = await getChatById(chatId);
  chat.participants = chat.participants.filter((participant) => String(participant) !== String(userId));
  await chat.save();
  return chat;
};

const transferChat = async (chatId, newAssignedTo) => {
  const chat = await getChatById(chatId);
  chat.assignedTo = newAssignedTo;
  await chat.save();
  return chat;
};

const convertChat = async (chatId, type, context = {}) => {
  const chat = await getChatById(chatId);
  chat.type = type;
  chat.context = {
    ...chat.context,
    ...context,
  };
  await chat.save();
  return chat;
};

const linkChats = async (chatId, linkedChatId) => {
  const chat = await getChatById(chatId);
  await getChatById(linkedChatId);
  chat.linkedChats = [...new Set([...chat.linkedChats.map((id) => String(id)), String(linkedChatId)])];
  await chat.save();
  return chat;
};

module.exports = {
  createChat,
  getUserChats,
  getChatById,
  addParticipants,
  removeParticipant,
  transferChat,
  convertChat,
  linkChats,
};
