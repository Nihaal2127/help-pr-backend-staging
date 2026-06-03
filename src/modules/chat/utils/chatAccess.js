const mongoose = require("mongoose");
const Chat = require("../models/chat.model");
const ChatError = require("./chatError");

/** User.type: 1 Admin, 5 Super Admin */
const GLOBAL_ADMIN_TYPES = [1, 5];
const MANAGE_CHAT_ROLES = ["admin", "employee"];

const isGlobalAdmin = (userType) => GLOBAL_ADMIN_TYPES.includes(Number(userType));

const isParticipant = (userId, chat) =>
  (chat.participants || []).some((participant) => String(participant) === String(userId));

const isAssignedAgent = (userId, chat) =>
  chat.assignedTo && String(chat.assignedTo) === String(userId);

const getChatRole = (userId, chat) => {
  const entry = (chat.roles || []).find((role) => String(role.userId) === String(userId));
  return entry?.role || null;
};

const canAccessChat = (userId, chat, userType) =>
  isGlobalAdmin(userType) || isParticipant(userId, chat) || isAssignedAgent(userId, chat);

const canManageChat = (userId, chat, userType) => {
  if (isGlobalAdmin(userType)) return true;
  if (isAssignedAgent(userId, chat)) return true;
  const role = getChatRole(userId, chat);
  return MANAGE_CHAT_ROLES.includes(role);
};

const findChatById = async (chatId) => {
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new ChatError("chatId must be a valid ObjectId.", 400, "INVALID_ID");
  }
  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new ChatError("Chat not found.", 404, "CHAT_NOT_FOUND");
  }
  return chat;
};

const assertChatAccess = async (chatId, userId, userType) => {
  const chat = await findChatById(chatId);
  if (!canAccessChat(userId, chat, userType)) {
    throw new ChatError("You do not have access to this chat.", 403, "CHAT_FORBIDDEN");
  }
  return chat;
};

const assertChatManageAccess = async (chatId, userId, userType) => {
  const chat = await assertChatAccess(chatId, userId, userType);
  if (!canManageChat(userId, chat, userType)) {
    throw new ChatError("You do not have permission to manage this chat.", 403, "CHAT_FORBIDDEN");
  }
  return chat;
};

module.exports = {
  assertChatAccess,
  assertChatManageAccess,
  findChatById,
  canAccessChat,
  canManageChat,
};
