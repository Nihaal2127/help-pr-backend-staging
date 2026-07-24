const mongoose = require('mongoose');

const whatsappWebhookLogSchema = new mongoose.Schema({
  event_type: { type: String, required: true, trim: true },
  field: { type: String, default: null, trim: true },
  provider_message_id: { type: String, default: null, trim: true, index: true },
  phone_number: { type: String, default: null, trim: true },
  status: { type: String, default: null, trim: true },
  template_name: { type: String, default: null, trim: true },
  template_language: { type: String, default: null, trim: true },
  template_event: { type: String, default: null, trim: true },
  error_code: { type: String, default: null, trim: true },
  error_message: { type: String, default: null, trim: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: null },
  created_at: { type: Date, default: Date.now },
});

whatsappWebhookLogSchema.index({ created_at: -1 });

module.exports = mongoose.model('whatsapp_webhook_log', whatsappWebhookLogSchema);
