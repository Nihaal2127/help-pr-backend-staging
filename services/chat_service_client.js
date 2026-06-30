const axios = require("axios");

const isChatServiceEnabled = () =>
  process.env.CHAT_SERVICE_ENABLED === "true" &&
  Boolean(process.env.CHAT_SERVICE_BASE_URL) &&
  Boolean(process.env.CHAT_SERVICE_INTERNAL_API_KEY);

const createClient = () => {
  if (!isChatServiceEnabled()) {
    return null;
  }

  return axios.create({
    baseURL: process.env.CHAT_SERVICE_BASE_URL.replace(/\/$/, ""),
    headers: {
      "X-Internal-Api-Key": process.env.CHAT_SERVICE_INTERNAL_API_KEY,
      "Content-Type": "application/json",
    },
    timeout: parseInt(process.env.CHAT_SERVICE_TIMEOUT_MS || "10000", 10),
  });
};

const callInternal = async (method, path, body) => {
  const client = createClient();
  if (!client) {
    return { ok: false, skipped: true, message: "Chat service client is not configured." };
  }

  try {
    const response = await client.request({ method, url: path, data: body });
    return { ok: true, skipped: false, data: response.data };
  } catch (error) {
    const status = error.response?.status || 500;
    const payload = error.response?.data || {};
    console.error(`Chat service ${method} ${path}:`, payload.message || error.message);
    return {
      ok: false,
      skipped: false,
      status,
      message: payload.message || error.message,
      data: payload,
    };
  }
};

/**
 * Provision order group chat after order is committed.
 * POST /internal/chats/order
 */
const provisionOrderChat = async (orderId) => {
  const result = await callInternal("post", "/internal/chats/order", { orderId: String(orderId) });
  if (!result.ok) return result;
  return { ok: true, chatId: result.data?.chatId, created: result.data?.created, data: result.data };
};

/**
 * Sync order chat participants after order update.
 * POST /internal/chats/order/sync
 */
const syncOrderChat = async (orderId) => {
  const result = await callInternal("post", "/internal/chats/order/sync", { orderId: String(orderId) });
  if (!result.ok) return result;
  return { ok: true, chatId: result.data?.chatId, data: result.data };
};

/**
 * Provision dispute chat after dispute is committed.
 * POST /internal/chats/dispute
 */
const provisionDisputeChat = async ({ disputeId, reason, description }) => {
  const result = await callInternal("post", "/internal/chats/dispute", {
    disputeId: String(disputeId),
    reason,
    description,
  });
  if (!result.ok) return result;
  return { ok: true, chatId: result.data?.chatId, created: result.data?.created, data: result.data };
};

/**
 * Apply chat side effects when dispute status changes.
 * POST /internal/chats/dispute-status
 */
const applyDisputeChatStatus = async ({ disputeId, chatId, status, actorUserId }) => {
  const result = await callInternal("post", "/internal/chats/dispute-status", {
    disputeId: String(disputeId),
    chatId: chatId ? String(chatId) : undefined,
    status,
    actorUserId: actorUserId ? String(actorUserId) : undefined,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data };
};

const getChatServiceBaseUrl = () => {
  if (!process.env.CHAT_SERVICE_BASE_URL) return null;
  return process.env.CHAT_SERVICE_BASE_URL.replace(/\/$/, "");
};

/**
 * Proxy mobile support chat to Chat Service (forwards customer JWT).
 * POST /api/mobile/user/chats/support
 */
const proxyMobileSupportChat = async (authorizationHeader, body) => {
  const baseURL = getChatServiceBaseUrl();
  if (!baseURL) {
    return { ok: false, status: 503, message: "Chat service is not configured." };
  }

  if (!authorizationHeader) {
    return { ok: false, status: 401, message: "Authorization header is required." };
  }

  try {
    const response = await axios.post(`${baseURL}/api/mobile/user/chats/support`, body, {
      headers: {
        Authorization: authorizationHeader,
        "Content-Type": "application/json",
      },
      timeout: parseInt(process.env.CHAT_SERVICE_TIMEOUT_MS || "10000", 10),
    });

    return {
      ok: true,
      status: response.status,
      data: response.data,
    };
  } catch (error) {
    const status = error.response?.status || 500;
    const payload = error.response?.data || {};
    console.error("Chat service proxy support chat:", payload.message || error.message);
    return {
      ok: false,
      status,
      message: payload.message || error.message,
      data: payload,
    };
  }
};

module.exports = {
  isChatServiceEnabled,
  provisionOrderChat,
  syncOrderChat,
  provisionDisputeChat,
  applyDisputeChatStatus,
  proxyMobileSupportChat,
};
