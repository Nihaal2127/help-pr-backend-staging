const mongoose = require("mongoose");

const readTrackingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "user",
    },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "chat",
    },
    lastReadAt: {
      type: Date,
      default: new Date(0),
    },
  },
  { timestamps: true }
);

readTrackingSchema.index({ userId: 1, chatId: 1 }, { unique: true });

module.exports = mongoose.model("chat_read_tracking", readTrackingSchema);
