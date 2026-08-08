const mongoose = require("mongoose");

const PLATFORMS = ["ios", "android", "unknown"];

const userDeviceTokenSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "user",
      index: true,
    },
    device_token: { type: String, required: true, trim: true },
    platform: {
      type: String,
      enum: PLATFORMS,
      default: "unknown",
      trim: true,
    },
    device_id: { type: String, default: null, trim: true },
    last_active_at: { type: Date, default: Date.now },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

userDeviceTokenSchema.index({ device_token: 1 }, { unique: true });
userDeviceTokenSchema.index({ user_id: 1, last_active_at: -1 });
userDeviceTokenSchema.index(
  { user_id: 1, device_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      device_id: { $exists: true, $type: "string", $ne: "" },
    },
  }
);

module.exports = mongoose.model("user_device_token", userDeviceTokenSchema);
module.exports.PLATFORMS = PLATFORMS;
