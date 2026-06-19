const mongoose = require("mongoose");

const disputeSchema = new mongoose.Schema(
  {
    unique_id: { type: String, default: "", trim: true },
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "order",
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "user",
      index: true,
    },
    employee_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "user",
    },
    franchise_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "franchise",
      index: true,
    },
    reason: { type: String, default: "", trim: true, maxlength: 500 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ["open", "in_review", "resolved", "closed"],
      default: "open",
      index: true,
    },
    chat_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "chat",
    },
    resolved_at: { type: Date, default: null },
    resolved_by_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "user",
    },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: false }
);

disputeSchema.index({ order_id: 1, status: 1, deleted_at: 1 });
disputeSchema.index({ unique_id: 1 });
disputeSchema.index(
  { order_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deleted_at: null,
      status: { $in: ["open", "in_review"] },
    },
  }
);

module.exports = mongoose.model("dispute", disputeSchema);
