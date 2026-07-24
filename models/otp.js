const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  phone_number: { type: String, required: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  provider_message_id: { type: String, default: null },
  delivery_status: { type: String, default: null, trim: true },
  delivery_status_at: { type: Date, default: null },
  delivery_error: { type: String, default: null, trim: true },
});

otpSchema.index({ phone_number: 1, expiresAt: 1 });
otpSchema.index({ provider_message_id: 1 });

module.exports = mongoose.model('otp', otpSchema);
