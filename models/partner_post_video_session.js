const mongoose = require('mongoose');

const partnerPostVideoSessionSchema = new mongoose.Schema(
  {
    partner_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: true,
    },
    bunny_video_id: { type: String, required: true, trim: true },
    expires_at: { type: Date, required: true },
    consumed_post_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'partner_post',
    },
    consumed_at: { type: Date, default: null },
    last_webhook_status: { type: Number, default: null },
    last_webhook_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

partnerPostVideoSessionSchema.index({ bunny_video_id: 1 }, { unique: true });
partnerPostVideoSessionSchema.index({ partner_id: 1, consumed_post_id: 1, expires_at: 1 });

module.exports = mongoose.model('partner_post_video_session', partnerPostVideoSessionSchema);
