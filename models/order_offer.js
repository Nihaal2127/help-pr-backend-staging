const mongoose = require("mongoose");

const orderOfferSchema = new mongoose.Schema(
  {
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "order",
    },
    offer_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "offers",
      index: true,
    },
    /** Snapshots for reporting (offer at time of order). */
    offer_unique_id: { type: String, default: "", trim: true },
    offer_name: { type: String, default: "", trim: true },
    offer_type: { type: String, default: "percentage", trim: true },
    offer_value: { type: Number, default: 0 },

    total_service_price: { type: Number, required: true, min: 0 },
    commission_amount: { type: Number, required: true, min: 0 },
    /** Percentages snapshotted from offer.admin_contribution / partner_contribution */
    admin_contribution: { type: Number, required: true, min: 0 },
    partner_contribution: { type: Number, required: true, min: 0 },
    admin_contribution_amount: { type: Number, required: true, min: 0 },
    partner_contribution_amount: { type: Number, required: true, min: 0 },
    total_discount: { type: Number, required: true, min: 0 },

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

orderOfferSchema.index({ order_id: 1 }, { unique: true });

module.exports = mongoose.model("order_offer", orderOfferSchema);
