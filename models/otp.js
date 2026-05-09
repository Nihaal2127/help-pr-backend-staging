const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  phone_number: { type: String, required: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

module.exports = mongoose.model('otp', otpSchema);
