const mongoose = require("mongoose");
const Chat = require("../models/chat.model");
const Order = require("../../../../models/order");
const User = require("../../../../models/user");
const Franchise = require("../../../../models/franchise");
const {
  USER_TYPE_ADMIN,
  USER_TYPE_PARTNER,
  USER_TYPE_EMPLOYEE,
  USER_TYPE_CUSTOMER,
} = require("../../../../constants/user_types");
const { createSystemMessage } = require("./message.service");

const CHAT_ROLE_BY_USER_TYPE = {
  [USER_TYPE_ADMIN]: "admin",
  [USER_TYPE_PARTNER]: "partner",
  [USER_TYPE_EMPLOYEE]: "employee",
  [USER_TYPE_CUSTOMER]: "customer",
};

const addParticipantId = (set, value) => {
  if (value == null || value === "") return;
  const id = String(value).trim();
  if (mongoose.Types.ObjectId.isValid(id)) {
    set.add(id);
  }
};

const buildRolesForParticipantIds = async (participantIds) => {
  const objectIds = participantIds
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (!objectIds.length) return [];

  const users = await User.find({ _id: { $in: objectIds } })
    .select("_id type")
    .lean();

  return users.map((user) => ({
    userId: user._id,
    role: CHAT_ROLE_BY_USER_TYPE[Number(user.type)] || "employee",
  }));
};

const mergeRoles = (existingRoles, newRoles) => {
  const byUserId = new Map();
  (existingRoles || []).forEach((entry) => {
    byUserId.set(String(entry.userId), entry);
  });
  (newRoles || []).forEach((entry) => {
    byUserId.set(String(entry.userId), entry);
  });
  return [...byUserId.values()];
};

const createProvisionedChat = async ({
  type,
  isGroup,
  participants,
  context = {},
  assignedTo = null,
  systemMessage = null,
}) => {
  const uniqueParticipants = [
    ...new Set(
      (participants || [])
        .map((id) => String(id).trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];

  if (!uniqueParticipants.length) {
    return null;
  }

  const roles = await buildRolesForParticipantIds(uniqueParticipants);
  const chat = await Chat.create({
    type,
    isGroup: isGroup ?? uniqueParticipants.length > 2,
    participants: uniqueParticipants,
    roles,
    context,
    assignedTo: assignedTo || null,
    status: "open",
    linkedChats: [],
  });

  if (systemMessage) {
    await createSystemMessage(chat._id, systemMessage);
  }

  return chat;
};

const syncChatParticipantsInternal = async (chat, targetParticipantIds, systemMessage = null) => {
  if (!chat) return null;

  const current = new Set((chat.participants || []).map((id) => String(id)));
  const target = new Set(
    (targetParticipantIds || [])
      .map((id) => String(id).trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
  );

  const toAdd = [...target].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !target.has(id));

  if (!toAdd.length && !toRemove.length) {
    return chat;
  }

  if (toRemove.length) {
    const removeSet = new Set(toRemove);
    chat.participants = (chat.participants || []).filter(
      (participant) => !removeSet.has(String(participant))
    );
    chat.roles = (chat.roles || []).filter((role) => !removeSet.has(String(role.userId)));
  }

  if (toAdd.length) {
    chat.participants = [...new Set([...(chat.participants || []).map((id) => String(id)), ...toAdd])];
    const newRoles = await buildRolesForParticipantIds(toAdd);
    chat.roles = mergeRoles(chat.roles, newRoles);
  }

  chat.isGroup = chat.participants.length > 2 ? true : chat.isGroup;
  await chat.save();

  if (toRemove.length) {
    await createSystemMessage(
      chat._id,
      systemMessage || "Chat participants were updated."
    );
  } else if (toAdd.length) {
    await createSystemMessage(
      chat._id,
      systemMessage || "New participants were added to this chat."
    );
  }

  return chat;
};

const resolveOrderChatParticipantIds = async (order) => {
  const ids = new Set();
  addParticipantId(ids, order?.user_id);
  addParticipantId(ids, order?.partner_id);
  addParticipantId(ids, order?.employee_id);

  if (order?.franchise_id) {
    const franchise = await Franchise.findById(order.franchise_id)
      .select("admin_id")
      .lean();
    addParticipantId(ids, franchise?.admin_id);
  }

  return [...ids];
};

const findOrderChat = async (orderId) => {
  if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
    return null;
  }
  return Chat.findOne({
    type: "order",
    "context.orderId": new mongoose.Types.ObjectId(String(orderId)),
  });
};

const linkOrderToChat = async (orderId, chatId) => {
  if (!orderId || !chatId) return;
  await Order.updateOne(
    { _id: orderId },
    { $set: { chat_id: chatId, updated_at: new Date() } }
  );
};

const createOrderChatForOrder = async (order) => {
  if (!order?._id) return null;

  const participantIds = await resolveOrderChatParticipantIds(order);
  if (!participantIds.length) return null;

  const orderLabel = order.unique_id || String(order._id);
  let chat = await findOrderChat(order._id);

  if (chat) {
    chat = await syncChatParticipantsInternal(
      chat,
      participantIds,
      "Order chat participants were updated."
    );
    await linkOrderToChat(order._id, chat._id);
    return chat;
  }

  chat = await createProvisionedChat({
    type: "order",
    isGroup: true,
    participants: participantIds,
    context: { orderId: order._id },
    assignedTo: order.employee_id || null,
    systemMessage: `Order chat created for order ${orderLabel}.`,
  }).catch(async (error) => {
    if (error?.code === 11000) {
      return findOrderChat(order._id);
    }
    throw error;
  });

  if (!chat) {
    chat = await findOrderChat(order._id);
  }

  if (chat) {
    await linkOrderToChat(order._id, chat._id);
  }

  return chat;
};

const safeCreateOrderChatForOrder = async (order, options = {}) => {
  try {
    return await createOrderChatForOrder(order);
  } catch (err) {
    console.error("safeCreateOrderChatForOrder:", err.message);
    return null;
  }
};

const syncOrderChatForOrder = async (order) => {
  if (!order?._id) return null;

  let chat = null;
  if (order.chat_id) {
    chat = await Chat.findById(order.chat_id);
  }
  if (!chat) {
    chat = await findOrderChat(order._id);
  }
  if (!chat) {
    return createOrderChatForOrder(order);
  }

  const participantIds = await resolveOrderChatParticipantIds(order);
  chat = await syncChatParticipantsInternal(
    chat,
    participantIds,
    "Order chat participants were updated."
  );

  if (order.employee_id && String(chat.assignedTo || "") !== String(order.employee_id)) {
    chat.assignedTo = order.employee_id;
    await chat.save();
  }

  await linkOrderToChat(order._id, chat._id);
  return chat;
};

const safeSyncOrderChatForOrder = async (order) => {
  try {
    return await syncOrderChatForOrder(order);
  } catch (err) {
    console.error("safeSyncOrderChatForOrder:", err.message);
    return null;
  }
};

const resolveCustomerFranchiseId = async (customerId, franchiseId) => {
  if (franchiseId && mongoose.Types.ObjectId.isValid(String(franchiseId))) {
    return String(franchiseId);
  }

  const customer = await User.findById(customerId).select("franchise_id").lean();
  if (customer?.franchise_id) {
    return String(customer.franchise_id);
  }

  const latestOrder = await Order.findOne({
    user_id: customerId,
    deleted_at: null,
    franchise_id: { $ne: null },
  })
    .sort({ created_at: -1 })
    .select("franchise_id employee_id")
    .lean();

  return latestOrder?.franchise_id ? String(latestOrder.franchise_id) : null;
};

const assertEmployeeAvailableForCustomer = async (employee, customerFranchiseId) => {
  if (!employee) {
    return { ok: false, status: 404, message: "Employee not found." };
  }
  if (employee.chat === false) {
    return { ok: false, status: 403, message: "This employee is not available for chat." };
  }
  if (
    customerFranchiseId &&
    employee.franchise_id &&
    String(employee.franchise_id) !== String(customerFranchiseId)
  ) {
    return {
      ok: false,
      status: 403,
      message: "This employee is not available for your franchise.",
    };
  }
  return { ok: true };
};

const resolveSupportEmployeeId = async ({ customerId, employeeId, franchiseId }) => {
  const customerFranchiseId = await resolveCustomerFranchiseId(customerId, franchiseId);

  if (employeeId && mongoose.Types.ObjectId.isValid(String(employeeId))) {
    const employee = await User.findOne({
      _id: employeeId,
      type: USER_TYPE_EMPLOYEE,
      deleted_at: null,
      is_active: true,
    })
      .select("_id franchise_id chat")
      .lean();

    const availability = await assertEmployeeAvailableForCustomer(employee, customerFranchiseId);
    if (!availability.ok) {
      return availability;
    }

    return { ok: true, employeeId: String(employee._id) };
  }

  if (!customerFranchiseId) {
    const latestOrder = await Order.findOne({
      user_id: customerId,
      deleted_at: null,
      employee_id: { $ne: null },
    })
      .sort({ created_at: -1 })
      .select("employee_id franchise_id")
      .lean();

    if (latestOrder?.employee_id) {
      const employee = await User.findOne({
        _id: latestOrder.employee_id,
        type: USER_TYPE_EMPLOYEE,
        deleted_at: null,
        is_active: true,
      })
        .select("_id franchise_id chat")
        .lean();

      const availability = await assertEmployeeAvailableForCustomer(
        employee,
        latestOrder.franchise_id ? String(latestOrder.franchise_id) : customerFranchiseId
      );
      if (availability.ok) {
        return { ok: true, employeeId: String(employee._id) };
      }
    }

    return {
      ok: false,
      status: 400,
      message: "employee_id is required when customer franchise cannot be resolved.",
    };
  }

  const employee = await User.findOne({
    franchise_id: customerFranchiseId,
    type: USER_TYPE_EMPLOYEE,
    deleted_at: null,
    is_active: true,
    chat: { $ne: false },
  })
    .sort({ created_at: 1 })
    .select("_id")
    .lean();

  if (!employee) {
    return {
      ok: false,
      status: 404,
      message: "No available employee found for support chat.",
    };
  }

  return { ok: true, employeeId: String(employee._id) };
};

const findOpenSupportChat = async (customerId, employeeId) => {
  const chat = await Chat.findOne({
    type: "support",
    status: "open",
    participants: {
      $all: [
        new mongoose.Types.ObjectId(String(customerId)),
        new mongoose.Types.ObjectId(String(employeeId)),
      ],
    },
  }).sort({ updatedAt: -1 });

  if (!chat || (chat.participants || []).length !== 2) {
    return null;
  }

  return chat;
};

const createOrGetSupportChat = async ({
  customerId,
  employeeId,
  franchiseId,
  initialMessage,
  actorUserId,
  userType = null,
}) => {
  const employeeResolution = await resolveSupportEmployeeId({
    customerId,
    employeeId,
    franchiseId,
  });

  if (!employeeResolution.ok) {
    return employeeResolution;
  }

  const resolvedEmployeeId = employeeResolution.employeeId;
  let created = false;
  let chat = await findOpenSupportChat(customerId, resolvedEmployeeId);

  if (!chat) {
    chat = await createProvisionedChat({
      type: "support",
      isGroup: false,
      participants: [customerId, resolvedEmployeeId],
      context: {},
      assignedTo: resolvedEmployeeId,
      systemMessage: "Support chat started.",
    });
    created = true;
  }

  if (!chat) {
    return { ok: false, status: 500, message: "Failed to create support chat." };
  }

  if (initialMessage && String(initialMessage).trim()) {
    const { sendMessage } = require("./message.service");
    await sendMessage(
      {
        chatId: chat._id,
        senderId: actorUserId,
        type: "text",
        content: String(initialMessage).trim(),
      },
      userType
    );
    chat = await Chat.findById(chat._id);
  }

  return { ok: true, chat, created };
};

const createDisputeChat = async ({ dispute, order, systemMessage }) => {
  const participants = [order.user_id, order.employee_id].filter(Boolean);
  if (participants.length < 2) {
    return null;
  }

  const chat = await createProvisionedChat({
    type: "dispute",
    isGroup: false,
    participants,
    context: {
      orderId: order._id,
      disputeId: dispute._id,
    },
    assignedTo: order.employee_id,
    systemMessage:
      systemMessage ||
      `Dispute ${dispute.unique_id || ""} opened for order ${order.unique_id || order._id}.`.trim(),
  });

  return chat;
};

const getOrderChatForUser = async (orderId, userId, userType) => {
  const { assertChatAccess } = require("../utils/chatAccess");
  const order = await Order.findOne({ _id: orderId, deleted_at: null }).lean();
  if (!order) {
    return { ok: false, status: 404, message: "Order not found." };
  }

  let chat = null;
  if (order.chat_id) {
    chat = await Chat.findById(order.chat_id);
  }
  if (!chat) {
    chat = await findOrderChat(orderId);
  }
  if (!chat) {
    return { ok: false, status: 404, message: "Order chat not found." };
  }

  await assertChatAccess(chat._id, userId, userType);
  return { ok: true, chat, order };
};

module.exports = {
  resolveOrderChatParticipantIds,
  createOrderChatForOrder,
  safeCreateOrderChatForOrder,
  syncOrderChatForOrder,
  safeSyncOrderChatForOrder,
  createOrGetSupportChat,
  createDisputeChat,
  findOrderChat,
  getOrderChatForUser,
  buildRolesForParticipantIds,
};
