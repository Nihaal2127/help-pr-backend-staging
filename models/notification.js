const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "user",
      index: true,
    },
    actor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "user",
    },
    category: {
      type: String,
      required: true,
      trim: true,
      enum: ["order", "quote", "subscription", "wallet", "ticket", "chat", "system"],
    },
    event: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, default: "", trim: true },
    entity_type: { type: String, default: "", trim: true },
    entity_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    franchise_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "franchise",
    },
    recipient_role: { type: String, default: "", trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    dedupe_key: { type: String, default: null, trim: true },
    is_read: { type: Boolean, default: false },
    read_at: { type: Date, default: null },
    push_sent_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: false }
);

notificationSchema.index({ recipient_user_id: 1, is_read: 1, created_at: -1 });
notificationSchema.index({ recipient_user_id: 1, category: 1, created_at: -1 });
notificationSchema.index(
  { dedupe_key: 1 },
  { unique: true, partialFilterExpression: { dedupe_key: { $type: "string" } } }
);

module.exports = mongoose.model("notification", notificationSchema);
