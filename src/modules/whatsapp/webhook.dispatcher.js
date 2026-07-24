const Otp = require('../../../models/otp');
const WhatsappWebhookLog = require('../../../models/whatsapp_webhook_log');
const { normalizeUserPhone } = require('../../../utils/user_contact_uniqueness');

const recipientToCanonicalPhone = (recipientId) => {
  const digits = String(recipientId || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith('91')) {
    return normalizeUserPhone(`+${digits}`);
  }
  if (digits.length === 10) {
    return normalizeUserPhone(digits);
  }
  return normalizeUserPhone(`+${digits}`);
};

const writeWebhookLog = async (entry) => {
  try {
    await WhatsappWebhookLog.create(entry);
  } catch (error) {
    console.error('[whatsapp-webhook] failed to write log:', error.message);
  }
};

const updateOtpDeliveryStatus = async ({ providerMessageId, status, errorMessage }) => {
  if (!providerMessageId) return;

  const update = {
    delivery_status: status,
    delivery_status_at: new Date(),
  };

  if (errorMessage) {
    update.delivery_error = errorMessage;
  }

  await Otp.updateOne({ provider_message_id: providerMessageId }, { $set: update });
};

const handleMessageStatusUpdate = async (value) => {
  const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
  const results = [];

  for (const statusEntry of statuses) {
    const providerMessageId = statusEntry?.id || null;
    const status = statusEntry?.status || null;
    const phone = recipientToCanonicalPhone(statusEntry?.recipient_id);
    const firstError = Array.isArray(statusEntry?.errors) ? statusEntry.errors[0] : null;
    const errorMessage = firstError
      ? `${firstError.code || 'error'}: ${firstError.title || firstError.message || 'Delivery failed'}`
      : null;

    await writeWebhookLog({
      event_type: 'message_status',
      field: 'messages',
      provider_message_id: providerMessageId,
      phone_number: phone,
      status,
      error_code: firstError?.code ? String(firstError.code) : null,
      error_message: errorMessage,
      payload: statusEntry,
    });

    await updateOtpDeliveryStatus({
      providerMessageId,
      status,
      errorMessage,
    });

    results.push({
      provider_message_id: providerMessageId,
      status,
      phone_number: phone,
    });
  }

  return results;
};

const handleIncomingMessage = async (value) => {
  const messages = Array.isArray(value?.messages) ? value.messages : [];
  const results = [];

  for (const message of messages) {
    const phone = recipientToCanonicalPhone(message?.from);
    await writeWebhookLog({
      event_type: 'incoming_message',
      field: 'messages',
      provider_message_id: message?.id || null,
      phone_number: phone,
      status: message?.type || null,
      payload: message,
    });

    results.push({
      provider_message_id: message?.id || null,
      phone_number: phone,
      type: message?.type || null,
    });
  }

  return results;
};

const handleTemplateStatusUpdate = async (value) => {
  await writeWebhookLog({
    event_type: 'template_status',
    field: 'message_template_status_update',
    template_name: value?.message_template_name || null,
    template_language: value?.message_template_language || null,
    template_event: value?.event || null,
    status: value?.event || null,
    error_message: value?.reason || null,
    payload: value,
  });

  return [
    {
      template_name: value?.message_template_name || null,
      event: value?.event || null,
    },
  ];
};

const dispatchWhatsAppWebhook = async (body) => {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const results = [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const field = change?.field;
      const value = change?.value || {};

      if (field === 'messages') {
        if (Array.isArray(value.statuses) && value.statuses.length > 0) {
          results.push(...(await handleMessageStatusUpdate(value)));
        }
        if (Array.isArray(value.messages) && value.messages.length > 0) {
          results.push(...(await handleIncomingMessage(value)));
        }
        continue;
      }

      if (field === 'message_template_status_update') {
        results.push(...(await handleTemplateStatusUpdate(value)));
      }
    }
  }

  return { ok: true, results };
};

module.exports = {
  dispatchWhatsAppWebhook,
};
