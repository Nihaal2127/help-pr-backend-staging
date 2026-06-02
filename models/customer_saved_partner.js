const mongoose = require('mongoose');

const customerSavedPartnerSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: true,
    },
    partner_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: true,
    },
    franchise_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'franchise',
      required: true,
    },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

customerSavedPartnerSchema.index({ user_id: 1, partner_id: 1 }, { unique: true });
customerSavedPartnerSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('customer_saved_partner', customerSavedPartnerSchema);
