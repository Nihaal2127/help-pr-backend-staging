const mongoose = require("mongoose");
const Chat = require("../models/chat.model");
const User = require("../../../../models/user");
const Dispute = require("../../../../models/dispute");
const ChatError = require("../utils/chatError");
const { assertChatAccess, assertChatManageAccess, resolveChatFranchiseId } = require("../utils/chatAccess");
const { fieldLabel } = require("../../../../utils/field_labels");
const { USER_TYPE_CUSTOMER, USER_TYPE_EMPLOYEE } = require("../../../../constants/user_types");
const { buildRolesForParticipantIds } = require("./chatProvisioning.service");
const { createSystemMessage } = require("./message.service");
const { emitToChat } = require("../sockets/chatEmitter");

const HANDOFF_CHAT_TYPES = new Set(["support", "dispute"]);

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

const getUserChatsWithUnread = async (userId) => {
  const chats = await getUserChats(userId);
  const readService = require("./read.service");
  const unreadMap = await readService.getUnreadCountsForChats(
    userId,
    chats.map((chat) => chat._id)
  );

  return chats.map((chat) => {
    const plain = chat.toObject ? chat.toObject() : { ...chat };
    return {
      ...plain,
      unreadCount: unreadMap.get(String(chat._id)) || 0,
    };
  });
};

const updateChatStatus = async (chatId, status, actorUserId, userType) => {
  const chat = await assertChatManageAccess(chatId, actorUserId, userType);
  chat.status = status;
  await chat.save();
  return chat;
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
  ensureObjectId(newAssignedTo, "newAssignedTo");
  const chat = await assertChatManageAccess(chatId, actorUserId, userType);
  const newAssigneeId = String(newAssignedTo);

  if (String(chat.assignedTo || "") === newAssigneeId) {
    return chat;
  }

  if (!HANDOFF_CHAT_TYPES.has(chat.type)) {
    chat.assignedTo = newAssignedTo;
    await chat.save();
    return chat;
  }

  const newEmployee = await User.findOne({
    _id: newAssignedTo,
    type: USER_TYPE_EMPLOYEE,
    deleted_at: null,
    is_active: true,
  })
    .select("_id name franchise_id chat")
    .lean();

  if (!newEmployee) {
    throw new ChatError("New assignee must be an active employee.", 400, "INVALID_ASSIGNEE");
  }

  if (newEmployee.chat === false) {
    throw new ChatError("This employee is not available for chat.", 403, "CHAT_FORBIDDEN");
  }

  const chatFranchiseId = await resolveChatFranchiseId(chat);
  if (
    chatFranchiseId &&
    newEmployee.franchise_id &&
    String(newEmployee.franchise_id) !== String(chatFranchiseId)
  ) {
    throw new ChatError("New assignee must belong to the chat franchise.", 403, "CHAT_FORBIDDEN");
  }

  const previousAssignedId = chat.assignedTo ? String(chat.assignedTo) : null;
  const participantUsers = await User.find({ _id: { $in: chat.participants || [] } })
    .select("_id type name")
    .lean();

  const customerIds = participantUsers
    .filter((user) => Number(user.type) === USER_TYPE_CUSTOMER)
    .map((user) => String(user._id));

  if (!customerIds.length) {
    throw new ChatError("Support and dispute chats must include a customer participant.", 409, "CHAT_INVALID");
  }

  const previousEmployee =
    participantUsers.find((user) => String(user._id) === previousAssignedId) ||
    participantUsers.find((user) => Number(user.type) === USER_TYPE_EMPLOYEE);

  const nextParticipants = [...new Set([...customerIds, newAssigneeId])];
  chat.participants = nextParticipants;
  chat.roles = await buildRolesForParticipantIds(nextParticipants);
  chat.assignedTo = newAssignedTo;
  chat.isGroup = false;
  await chat.save();

  if (chat.type === "dispute") {
    const disputeFilter = chat.context?.disputeId
      ? { _id: chat.context.disputeId, deleted_at: null }
      : { chat_id: chat._id, deleted_at: null };

    await Dispute.updateOne(disputeFilter, {
      $set: {
        employee_id: newAssignedTo,
        updated_at: new Date(),
      },
    });
  }

  const previousName = previousEmployee?.name || "previous handler";
  const newName = newEmployee.name || "new handler";
  const systemMessage = await createSystemMessage(
    chat._id,
    `Chat transferred from ${previousName} to ${newName}.`
  );
  emitToChat(chat._id, "receive_message", systemMessage);

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
  getUserChatsWithUnread,
  getChatById,
  addParticipants,
  removeParticipant,
  transferChat,
  convertChat,
  linkChats,
  updateChatStatus,
};
