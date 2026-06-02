const mongoose = require('mongoose');
const { REPORT_REASONS, REPORT_STATUSES, REPORT_STATUS_PENDING } = require('../enum/post_report_reason_enum');

const partnerPostReportSchema = new mongoose.Schema(
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
    reason: {
      type: String,
      enum: REPORT_REASONS,
      required: true,
      trim: true,
    },
    details: { type: String, default: '', trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: REPORT_STATUSES,
      default: REPORT_STATUS_PENDING,
      trim: true,
    },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

partnerPostReportSchema.index({ post_id: 1, user_id: 1 }, { unique: true });
partnerPostReportSchema.index({ status: 1, created_at: -1 });

module.exports = mongoose.model('partner_post_report', partnerPostReportSchema);
