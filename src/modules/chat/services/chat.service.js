const mongoose = require("mongoose");
const Chat = require("../models/chat.model");
const ChatError = require("../utils/chatError");
const { assertChatAccess, assertChatManageAccess } = require("../utils/chatAccess");
const { fieldLabel } = require("../../../../utils/field_labels");

const ensureObjectId = (value, fieldName) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new ChatError(`${fieldLabel(fieldName)} must be a valid ObjectId.`, 400, "INVALID_ID");
  }
};

const createChat = async (payload, creatorUserId) => {
  ensureObjectId(creatorUserId, "userId");
  const participants = [
    ...new Set([...(payload.participants || []).map((id) => String(id)), String(creatorUserId)]),
  ];
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
  const userObjectId = new mongoose.Types.ObjectId(userId);
  return Chat.find({
    $or: [{ participants: userObjectId }, { assignedTo: userObjectId }],
  }).sort({ updatedAt: -1 });
};

const getChatById = async (chatId, userId, userType) => {
  return assertChatAccess(chatId, userId, userType);
};

const addParticipants = async (chatId, userIds, actorUserId, userType) => {
  const chat = await assertChatManageAccess(chatId, actorUserId, userType);
  const newUserIds = [...new Set((userIds || []).map((id) => String(id)))];
  chat.participants = [...new Set([...chat.participants.map((id) => String(id)), ...newUserIds])];
  await chat.save();
  return chat;
};

const removeParticipant = async (chatId, userId, actorUserId, userType) => {
  const chat = await assertChatManageAccess(chatId, actorUserId, userType);
  const remaining = chat.participants.filter((participant) => String(participant) !== String(userId));
  if (remaining.length === 0) {
    throw new ChatError("Chat must have at least one participant.", 400, "VALIDATION_ERROR");
  }
  chat.participants = remaining;
  await chat.save();
  return chat;
};

const transferChat = async (chatId, newAssignedTo, actorUserId, userType) => {
  const chat = await assertChatManageAccess(chatId, actorUserId, userType);
  chat.assignedTo = newAssignedTo;
  await chat.save();
  return chat;
};

const convertChat = async (chatId, type, context, actorUserId, userType) => {
  const chat = await assertChatManageAccess(chatId, actorUserId, userType);
  chat.type = type;
  chat.context = {
    ...chat.context,
    ...context,
  };
  await chat.save();
  return chat;
};

const linkChats = async (chatId, linkedChatId, actorUserId, userType) => {
  const chat = await assertChatManageAccess(chatId, actorUserId, userType);
  await assertChatAccess(linkedChatId, actorUserId, userType);
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
