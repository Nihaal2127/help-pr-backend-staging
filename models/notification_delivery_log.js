const mongoose = require("mongoose");

const notificationDeliveryLogSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, trim: true, index: true },
    category: { type: String, default: "", trim: true },
    actor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "user",
    },
    recipient_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "user",
      index: true,
    },
    recipient_role: { type: String, default: "", trim: true },
    notification_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "notification",
    },
    title: { type: String, default: "", trim: true },
    body: { type: String, default: "", trim: true },
    entity_type: { type: String, default: "", trim: true },
    entity_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    franchise_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "franchise",
    },
    dedupe_key: { type: String, default: null, trim: true },
    in_app_created: { type: Boolean, default: false },
    push_attempted: { type: Boolean, default: false },
    push_sent: { type: Boolean, default: false },
    push_skip_reason: { type: String, default: "", trim: true },
    push_error: { type: String, default: "", trim: true },
    push_error_code: { type: String, default: "", trim: true },
    firebase_target: { type: String, default: "", trim: true },
    device_token_suffix: { type: String, default: "", trim: true },
    user_type: { type: Number, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    created_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

notificationDeliveryLogSchema.index({ event: 1, created_at: -1 });
notificationDeliveryLogSchema.index({ recipient_user_id: 1, created_at: -1 });
notificationDeliveryLogSchema.index({ entity_type: 1, entity_id: 1, created_at: -1 });

module.exports = mongoose.model(
  "notification_delivery_log",
  notificationDeliveryLogSchema
);
