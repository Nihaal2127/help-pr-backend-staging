const mongoose = require("mongoose");

var schema = mongoose.Schema;

var notificationSettingsSchema = new schema(
  {

    user_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
    is_sms_allow: { type: Boolean, default: true },
    is_reminder_allow: { type: Boolean, default: true },
    is_update_allow: { type: Boolean, default: true },
    
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);


notificationSettingsSchema.index({ user_id: 1 });


module.exports = mongoose.model("notification_setting", notificationSettingsSchema);
