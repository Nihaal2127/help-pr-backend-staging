const mongoose = require("mongoose");

var schema = mongoose.Schema;

var businessInfoSchema = new schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, default: null,ref:'user' },
    name: { type: String, trim: true, default: null },
    email: { type: String, trim: true, default: null },
    phone_number: { type: String, trim: true, default: null },
    provided_service: { type: String, trim: true, default: null },
   
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);


businessInfoSchema.index({ email: 1, phone_number: 1, deleted_at: 1 }, { unique: true });
businessInfoSchema.index({ email: 1, });
businessInfoSchema.index({ phone_number: 1, });


module.exports = mongoose.model("business_info", businessInfoSchema);
