const mongoose = require("mongoose");

var schema = mongoose.Schema;

var quoteSchema = new schema(
  {
    quote_sequence_id: { type: String, default: "", trim: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    partner_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    employee_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    created_by_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    category_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "category" },
    service_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "service" },
    franchise_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "franchise" },
    address_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "address" },
    service_price: { type: Number, default: 0 },
    status: { type: Number, default: 1 },
    from_date: { type: Date, default: null },
    to_date: { type: Date, default: null },
    work_hours_per_day: { type: Number, default: 0 },
    total_work_hours: { type: Number, default: 0 },
    work_start_time: { type: String, default: "" },
    work_end_time: { type: String, default: "" },
    order_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "order" },
    cancellation_reason: { type: String, default: "", trim: true },
    rejection_reason: { type: String, default: "", trim: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);

quoteSchema.index({ user_id: 1 });
quoteSchema.index({ partner_id: 1 });
quoteSchema.index({ employee_id: 1 });
quoteSchema.index({ franchise_id: 1 });
quoteSchema.index({ category_id: 1 });
quoteSchema.index({ service_id: 1 });
quoteSchema.index({ status: 1 });
quoteSchema.index({ deleted_at: 1 });
quoteSchema.index({ quote_sequence_id: 1 });

module.exports = mongoose.model("quote", quoteSchema);
