/**
 * Bridges in-process chat provisioning (legacy) and remote Chat Service (VPS).
 * Set CHAT_SERVICE_ENABLED=true to use the VPS internal APIs.
 */
const Order = require("../models/order");
const {
  isChatServiceEnabled,
  provisionOrderChat,
  syncOrderChat,
  provisionDisputeChat,
  applyDisputeChatStatus,
} = require("./chat_service_client");
const {
  safeCreateOrderChatForOrder,
  safeSyncOrderChatForOrder,
  createDisputeChat,
} = require("../src/modules/chat/services/chatProvisioning.service");
const { createSystemMessage } = require("../src/modules/chat/services/message.service");
const Chat = require("../src/modules/chat/models/chat.model");
const {
  DISPUTE_STATUS_RESOLVED,
  DISPUTE_STATUS_CLOSED,
  DISPUTE_STATUS_IN_REVIEW,
} = require("../enum/dispute_status_enum");

const provisionOrderChatForOrder = async (order) => {
  if (!order?._id) return null;

  if (isChatServiceEnabled()) {
    const result = await provisionOrderChat(order._id);
    if (result.ok && result.chatId) {
      await Order.updateOne(
        { _id: order._id, chat_id: null },
        { $set: { chat_id: result.chatId, updated_at: new Date() } }
      );
    }
    return result.ok ? { _id: result.chatId } : null;
  }

  return safeCreateOrderChatForOrder(order);
};

const syncOrderChatForOrderRecord = async (order) => {
  if (!order?._id) return null;

  if (isChatServiceEnabled()) {
    const result = await syncOrderChat(order._id);
    return result.ok ? { _id: result.chatId } : null;
  }

  return safeSyncOrderChatForOrder(order);
};

const provisionDisputeChatForRecord = async ({ dispute, order, reason, description, unique_id }) => {
  if (isChatServiceEnabled()) {
    const result = await provisionDisputeChat({
      disputeId: dispute._id,
      reason,
      description,
    });
    if (!result.ok) {
      return { ok: false, message: result.message || "Failed to create dispute chat." };
    }
    return { ok: true, chat: { _id: result.chatId } };
  }

  const chat = await createDisputeChat({
    dispute,
    order,
    systemMessage: `Dispute ${unique_id} opened.`,
  });

  if (!chat) {
    return { ok: false, message: "Failed to create dispute chat." };
  }

  const intro = [reason, description]
    .map((value) => (value ? String(value).trim() : ""))
    .filter(Boolean)
    .join("\n");
  if (intro) {
    await createSystemMessage(chat._id, `Customer dispute reason:\n${intro}`);
  }

  return { ok: true, chat };
};

const applyDisputeStatusChatEffects = async ({ dispute, nextStatus }) => {
  if (!dispute?.chat_id) return;

  if (isChatServiceEnabled()) {
    await applyDisputeChatStatus({
      disputeId: dispute._id,
      chatId: dispute.chat_id,
      status: nextStatus,
    });
    return;
  }

  if ([DISPUTE_STATUS_RESOLVED, DISPUTE_STATUS_CLOSED].includes(nextStatus)) {
    await Chat.updateOne({ _id: dispute.chat_id }, { $set: { status: "closed" } });
    await createSystemMessage(dispute.chat_id, `Dispute marked as ${nextStatus}.`);
  } else if (nextStatus === DISPUTE_STATUS_IN_REVIEW) {
    await createSystemMessage(dispute.chat_id, "Dispute is now in review.");
  }
};

module.exports = {
  provisionOrderChatForOrder,
  syncOrderChatForOrderRecord,
  provisionDisputeChatForRecord,
  applyDisputeStatusChatEffects,
};
