const mongoose = require('mongoose');

const partnerPostLikeSchema = new mongoose.Schema(
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
      required: true,
    },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

partnerPostLikeSchema.index({ post_id: 1, user_id: 1 }, { unique: true });
partnerPostLikeSchema.index({ user_id: 1, post_id: 1 });

module.exports = mongoose.model('partner_post_like', partnerPostLikeSchema);
