/**
 * Chat provisioning via remote Chat Service (VPS) only.
 * Requires CHAT_SERVICE_ENABLED=true and related env vars.
 */
const Order = require("../models/order");
const {
  isChatServiceEnabled,
  provisionOrderChat,
  syncOrderChat,
  provisionDisputeChat,
  applyDisputeChatStatus,
} = require("./chat_service_client");

const logChatServiceUnavailable = (action) => {
  console.error(
    `Chat service not configured (${action}). Set CHAT_SERVICE_ENABLED, CHAT_SERVICE_BASE_URL, and CHAT_SERVICE_INTERNAL_API_KEY.`
  );
};

const provisionOrderChatForOrder = async (order) => {
  if (!order?._id) return null;

  if (!isChatServiceEnabled()) {
    logChatServiceUnavailable("provision order chat");
    return null;
  }

  const result = await provisionOrderChat(order._id);
  if (result.ok && result.chatId) {
    await Order.updateOne(
      { _id: order._id, chat_id: null },
      { $set: { chat_id: result.chatId, updated_at: new Date() } }
    );
  }
  return result.ok ? { _id: result.chatId } : null;
};

const syncOrderChatForOrderRecord = async (order) => {
  if (!order?._id) return null;

  if (!isChatServiceEnabled()) {
    logChatServiceUnavailable("sync order chat");
    return null;
  }

  const result = await syncOrderChat(order._id);
  return result.ok ? { _id: result.chatId } : null;
};

const provisionDisputeChatForRecord = async ({ dispute, reason, description }) => {
  if (!isChatServiceEnabled()) {
    return { ok: false, message: "Chat service is not configured." };
  }

  const result = await provisionDisputeChat({
    disputeId: dispute._id,
    reason,
    description,
  });

  if (!result.ok) {
    return { ok: false, message: result.message || "Failed to create dispute chat." };
  }

  return { ok: true, chat: { _id: result.chatId } };
};

const applyDisputeStatusChatEffects = async ({ dispute, nextStatus }) => {
  if (!dispute?.chat_id) return;

  if (!isChatServiceEnabled()) {
    logChatServiceUnavailable("dispute status chat effects");
    return;
  }

  const result = await applyDisputeChatStatus({
    disputeId: dispute._id,
    chatId: dispute.chat_id,
    status: nextStatus,
  });

  if (!result.ok) {
    console.error("applyDisputeStatusChatEffects:", result.message || "Chat service call failed.");
  }
};

module.exports = {
  provisionOrderChatForOrder,
  syncOrderChatForOrderRecord,
  provisionDisputeChatForRecord,
  applyDisputeStatusChatEffects,
};
