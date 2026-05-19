const mongoose = require('mongoose');

const partnerCategorySchema = new mongoose.Schema(
  {
    partner_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'user',
      required: true,
    },
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'category',
      required: true,
    },
    services: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'service' }],
      default: [],
    },
    /** Local partner offering preference (is_enabled); effective visibility is resolver-computed. */
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: false }
);

partnerCategorySchema.index(
  { partner_id: 1, category_id: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);
partnerCategorySchema.index({ partner_id: 1, deleted_at: 1 });

module.exports = mongoose.model('partner_category', partnerCategorySchema);
