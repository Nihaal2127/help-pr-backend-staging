const mongoose = require('mongoose');
const { POST_TYPES, POST_TYPE_ORDER, POST_TYPE_LEGACY_WORK } = require('../enum/post_type_enum');
const { POST_STATUS_PUBLISHED, POST_STATUSES } = require('../enum/post_report_reason_enum');

const partnerPostSchema = new mongoose.Schema(
  {
    partner_id: {
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
    post_type: {
      type: String,
      enum: POST_TYPES,
      required: true,
    },
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'order',
    },
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'category',
    },
    service_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'service',
    },
    legacy_service_name: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true, maxlength: 500 },
    image_urls: { type: [String], default: [] },
    status: {
      type: String,
      enum: POST_STATUSES,
      default: POST_STATUS_PUBLISHED,
      trim: true,
    },
    share_token: { type: String, required: true, trim: true, unique: true },
    likes_count: { type: Number, default: 0, min: 0 },
    shares_count: { type: Number, default: 0, min: 0 },
    reports_count: { type: Number, default: 0, min: 0 },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: false }
);

partnerPostSchema.index({ partner_id: 1, deleted_at: 1, created_at: -1 });
partnerPostSchema.index({ franchise_id: 1, status: 1, deleted_at: 1, created_at: -1 });
partnerPostSchema.index({ order_id: 1, deleted_at: 1 });

module.exports = mongoose.model('partner_post', partnerPostSchema);
module.exports.POST_TYPE_ORDER = POST_TYPE_ORDER;
module.exports.POST_TYPE_LEGACY_WORK = POST_TYPE_LEGACY_WORK;
