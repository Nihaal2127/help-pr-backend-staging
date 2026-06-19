const mongoose = require('mongoose');

const passwordResetOtpSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'user',
    index: true,
  },
  otp_hash: { type: String, required: true },
  expires_at: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  verified: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});

passwordResetOtpSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('password_reset_otp', passwordResetOtpSchema);
