const mongoose = require("mongoose");

var schema = mongoose.Schema;

var orderServiceSchema = new schema(
  {
    order_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'order' },
    user_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
    partner_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },

    order_unique_id: { type: String, default: "", require: true },
    user_unique_id: { type: String, default: "", require: true },
    partner_unique_id: { type: String, default: "", require: true },
    
    payment_mode_id: { type: String, default: '', trim: true },
    transaction_id: { type: String, default: '', trim: true },
    
    category_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'category' },
    service_status: {
      type: String,
      default: "in-progress",
      enum: ["in-progress", "completed", "cancelled", "refunded"],
      trim: true,
    },
    service_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'service' },
    service_date: { type: Date, default: null },
    service_from_time: { type: Date, default: "", require: false },
    service_to_time: { type: Date, default: "", require: false },

    total_service_charge: { type: Number, default: 0 },
    commission_percent: { type: Number, default: 0 },
    commission_amount: { type: Number, default: 0 },
    sub_total: { type: Number, default: 0, require: true },
    tax: { type: Number, default: 0, require: true },
    tax_percent: { type: Number, default: 0 },
    tax_amount: { type: Number, default: 0 },
    user_paltform_fee: { type: Number, default: 0, require: true },
    partner_commison_platform_fee: { type: Number, default: 0, require: true },
    service_price: { type: Number, default: 0, require: true },
    total_price: { type: Number, default: 0, require: true },
    partner_earning: { type: Number, default: 0, require: true },
    admin_earning: { type: Number, default: 0, require: true },
    is_paid: { type: Boolean, default: false },
    cancellation_reasone: { type: String, default: "", require: false },
    rating: { type: Number, default: 0, require: true },
    review_text: { type: String, default: "", trim: true },
    reviewed_at: { type: Date, default: null },

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);


orderServiceSchema.index({ order_id: 1 });
orderServiceSchema.index({ service_status: 1 });
orderServiceSchema.index({ is_paid: 1 });
orderServiceSchema.index({ user_id: 1 });
orderServiceSchema.index({ partner_id: 1 });
orderServiceSchema.index({ category_id: 1 });
orderServiceSchema.index({ service_id: 1 });
orderServiceSchema.index({ deleted_at: 1 });
orderServiceSchema.index({ service_date: 1 });


module.exports = mongoose.model("order_service", orderServiceSchema);
