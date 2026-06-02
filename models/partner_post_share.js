const mongoose = require('mongoose');

const partnerPostShareSchema = new mongoose.Schema(
  {
    post_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'partner_post',
      required: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'user',
    },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

partnerPostShareSchema.index({ post_id: 1, created_at: -1 });
partnerPostShareSchema.index({ user_id: 1, post_id: 1 });

module.exports = mongoose.model('partner_post_share', partnerPostShareSchema);
