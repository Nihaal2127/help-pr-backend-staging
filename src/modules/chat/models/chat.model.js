const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "user",
    },
    role: {
      type: String,
      enum: ["customer", "employee", "admin", "partner"],
      required: true,
    },
  },
  { _id: false }
);

const chatSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["support", "order", "quote", "dispute"],
      required: true,
    },
    isGroup: { type: Boolean, default: false },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true,
      },
    ],
    roles: { type: [roleSchema], default: [] },
    context: {
      orderId: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "order" },
      quoteId: { type: mongoose.Schema.Types.ObjectId, default: null },
      disputeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    status: {
      type: String,
      enum: ["open", "closed", "pending"],
      default: "open",
    },
    linkedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: "chat" }],
    lastMessage: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

chatSchema.index({ participants: 1 });

module.exports = mongoose.model("chat", chatSchema);
