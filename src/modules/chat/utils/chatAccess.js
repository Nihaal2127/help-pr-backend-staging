const mongoose = require("mongoose");
const Chat = require("../models/chat.model");
const ChatError = require("./chatError");
const User = require("../../../../models/user");
const Order = require("../../../../models/order");
const Dispute = require("../../../../models/dispute");
const {
  USER_TYPE_ADMIN,
  USER_TYPE_EMPLOYEE,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
} = require("../../../../constants/user_types");

/** Platform-wide chat access (super admin only). */
const PLATFORM_ADMIN_TYPES = [USER_TYPE_SUPER_ADMIN];
const FRANCHISE_STAFF_TYPES = [USER_TYPE_ADMIN, USER_TYPE_EMPLOYEE, USER_TYPE_STAFF];
const MANAGE_CHAT_ROLES = ["admin", "employee"];

const isPlatformAdmin = (userType) => PLATFORM_ADMIN_TYPES.includes(Number(userType));

const isParticipant = (userId, chat) =>
  (chat.participants || []).some((participant) => String(participant) === String(userId));

const isAssignedAgent = (userId, chat) =>
  chat.assignedTo && String(chat.assignedTo) === String(userId);

const getChatRole = (userId, chat) => {
  const entry = (chat.roles || []).find((role) => String(role.userId) === String(userId));
  return entry?.role || null;
};

const resolveChatFranchiseId = async (chat) => {
  if (chat.context?.orderId) {
    const order = await Order.findById(chat.context.orderId).select("franchise_id").lean();
    return order?.franchise_id || null;
  }

  if (chat.context?.disputeId) {
    const dispute = await Dispute.findById(chat.context.disputeId).select("franchise_id").lean();
    return dispute?.franchise_id || null;
  }

  const participantIds = chat.participants || [];
  if (!participantIds.length) {
    return null;
  }

  const users = await User.find({ _id: { $in: participantIds } })
    .select("franchise_id type")
    .lean();

  const staffUser = users.find(
    (user) => FRANCHISE_STAFF_TYPES.includes(Number(user.type)) && user.franchise_id
  );
  if (staffUser?.franchise_id) {
    return staffUser.franchise_id;
  }

  return users.find((user) => user.franchise_id)?.franchise_id || null;
};

const matchesFranchiseScope = async (userId, userType, chat) => {
  if (!FRANCHISE_STAFF_TYPES.includes(Number(userType))) {
    return false;
  }

  const caller = await User.findById(userId).select("franchise_id").lean();
  if (!caller?.franchise_id) {
    return false;
  }

  const chatFranchiseId = await resolveChatFranchiseId(chat);
  if (!chatFranchiseId) {
    return false;
  }

  return String(caller.franchise_id) === String(chatFranchiseId);
};

const canAccessChat = async (userId, chat, userType) => {
  if (isPlatformAdmin(userType)) {
    return true;
  }
  if (isParticipant(userId, chat) || isAssignedAgent(userId, chat)) {
    return true;
  }
  return matchesFranchiseScope(userId, userType, chat);
};

const canManageChat = async (userId, chat, userType) => {
  if (isPlatformAdmin(userType)) {
    return true;
  }
  if (isAssignedAgent(userId, chat)) {
    return true;
  }

  const role = getChatRole(userId, chat);
  if (MANAGE_CHAT_ROLES.includes(role)) {
    return true;
  }

  if (Number(userType) === USER_TYPE_ADMIN && (await matchesFranchiseScope(userId, userType, chat))) {
    return true;
  }

  return false;
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
  if (!(await canAccessChat(userId, chat, userType))) {
    throw new ChatError("You do not have access to this chat.", 403, "CHAT_FORBIDDEN");
  }
  return chat;
};

const assertChatManageAccess = async (chatId, userId, userType) => {
  const chat = await assertChatAccess(chatId, userId, userType);
  if (!(await canManageChat(userId, chat, userType))) {
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
  resolveChatFranchiseId,
};
