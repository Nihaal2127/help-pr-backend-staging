const mongoose = require("mongoose");

const partnerServiceRatingSchema = new mongoose.Schema(
  {
    partner_id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "user" },
    service_id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "service" },
    rating_total: { type: Number, default: 0 },
    rating_count: { type: Number, default: 0 },
    average_rating: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);

partnerServiceRatingSchema.index(
  { partner_id: 1, service_id: 1, deleted_at: 1 },
  { unique: true }
);
partnerServiceRatingSchema.index({ partner_id: 1, deleted_at: 1 });
partnerServiceRatingSchema.index({ service_id: 1, deleted_at: 1 });

module.exports = mongoose.model("partner_service_rating", partnerServiceRatingSchema);
