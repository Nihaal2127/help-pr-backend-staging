const mongoose = require('mongoose');

const partnerPostSaveSchema = new mongoose.Schema(
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
    franchise_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'franchise',
      required: true,
    },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

partnerPostSaveSchema.index({ post_id: 1, user_id: 1 }, { unique: true });
partnerPostSaveSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('partner_post_save', partnerPostSaveSchema);
