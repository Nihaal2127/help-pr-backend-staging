const {
  safeNotifyBackofficeChatMessage,
} = require("../src/modules/notifications/services/backofficeHooks");
const {
  resolveFranchiseBackofficeRecipients,
} = require("../src/modules/notifications/resolvers/backofficeRecipients");

const verifyChatWebhookSecret = (req) => {
  const secret = process.env.CHAT_NOTIFICATION_WEBHOOK_SECRET;
  if (!secret) {
    return {
      ok: false,
      status: 503,
      message: "CHAT_NOTIFICATION_WEBHOOK_SECRET is not configured.",
    };
  }

  const provided = req.headers["x-webhook-secret"];
  if (!provided || String(provided) !== String(secret)) {
    return { ok: false, status: 401, message: "Unauthorized." };
  }

  return { ok: true };
};

const chatMessageWebhookHandler = async (req, res) => {
  const auth = verifyChatWebhookSecret(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      success: false,
      status: auth.status,
      message: auth.message,
    });
  }

  try {
    const {
      franchise_id: franchiseId,
      chat_id: chatId,
      order_id: orderId,
      sender_name: senderName,
      message_preview: messagePreview,
      chat_type: chatType,
      message_id: messageId,
    } = req.body || {};

    const recipientUserIds = await resolveFranchiseBackofficeRecipients(franchiseId);
    if (!recipientUserIds.length) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: "No franchise backoffice recipients for this message.",
        notifiedCount: 0,
      });
    }

    await safeNotifyBackofficeChatMessage({
      recipientUserIds,
      senderName,
      messagePreview,
      chatId,
      orderId,
      franchiseId,
      chatType,
      messageId,
      actorUserId: null,
    });

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Chat notification queued.",
      notifiedCount: recipientUserIds.length,
    });
  } catch (error) {
    console.error("[notifications] chat webhook failed:", error.message || error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Failed to process chat notification.",
    });
  }
};

module.exports = {
  chatMessageWebhookHandler,
  verifyChatWebhookSecret,
};
