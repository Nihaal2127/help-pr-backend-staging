const mongoose = require('mongoose');
const { POST_TYPES, POST_TYPE_ORDER, POST_TYPE_LEGACY_WORK } = require('../enum/post_type_enum');
const { POST_STATUS_PENDING, POST_STATUSES } = require('../enum/post_report_reason_enum');
const {
  POST_MEDIA_TYPE_IMAGE,
  POST_MEDIA_TYPES,
  VIDEO_STATUS_PROCESSING,
  VIDEO_STATUSES,
} = require('../enum/post_media_enum');

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
    description: { type: String, default: '', trim: true },
    media_type: {
      type: String,
      enum: POST_MEDIA_TYPES,
      default: POST_MEDIA_TYPE_IMAGE,
    },
    image_urls: { type: [String], default: [] },
    video: {
      type: new mongoose.Schema(
        {
          bunny_video_id: { type: String, default: '', trim: true },
          hls_url: { type: String, default: '', trim: true },
          thumbnail_url: { type: String, default: '', trim: true },
          duration_seconds: { type: Number, default: null },
          status: {
            type: String,
            enum: VIDEO_STATUSES,
            default: VIDEO_STATUS_PROCESSING,
          },
          failure_reason: { type: String, default: '', trim: true },
        },
        { _id: false }
      ),
      default: undefined,
    },
    status: {
      type: String,
      enum: POST_STATUSES,
      default: POST_STATUS_PENDING,
      trim: true,
    },
    rejection_reason: { type: String, default: '', trim: true },
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
partnerPostSchema.index({ 'video.bunny_video_id': 1 }, { sparse: true });

module.exports = mongoose.model('partner_post', partnerPostSchema);
module.exports.POST_TYPE_ORDER = POST_TYPE_ORDER;
module.exports.POST_TYPE_LEGACY_WORK = POST_TYPE_LEGACY_WORK;
