const mongoose = require("mongoose");

var schema = mongoose.Schema;

const quoteHistoryChangeSchema = new schema(
  {
    field: { type: String, default: "", trim: true },
    old_value: { type: mongoose.Schema.Types.Mixed, default: null },
    new_value: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const quoteHistoryEventSchema = new schema(
  {
    event_type: { type: String, default: "", trim: true },
    actor_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    actor_role: { type: String, default: "system", trim: true },
    actor_name: { type: String, default: "", trim: true },
    actor_unique_id: { type: String, default: "", trim: true },
    changes: { type: [quoteHistoryChangeSchema], default: [] },
    notes: { type: String, default: "", trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

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
    /** Partner base amount (same meaning as order.total_service_charge). */
    total_service_charge: { type: Number, default: 0 },
    /** Legacy alias; kept in sync with total_service_charge. */
    service_price: { type: Number, default: 0 },
    /** Snapshotted from service.commission at quote time (%). */
    commission_percent: { type: Number, default: 0 },
    /** total_service_charge × commission_percent / 100 */
    commission_amount: { type: Number, default: 0 },
    /** Snapshotted from service.tax at quote time (%). */
    tax_percent: { type: Number, default: 0 },
    /** Tax on sub_total after discount (quotes: no discount). */
    tax_amount: { type: Number, default: 0 },
    sub_total: { type: Number, default: 0 },
    /** Customer payable total (no additional charges / offers on quotes). */
    total_price: { type: Number, default: 0 },
    minimum_deposit_percent: { type: Number, default: 0 },
    minimum_deposit_amount: { type: Number, default: 0 },
    status: { type: String, default: "new", trim: true, lowercase: true },
    from_date: { type: Date, default: null },
    to_date: { type: Date, default: null },
    work_hours_per_day: { type: Number, default: 0 },
    total_work_hours: { type: Number, default: 0 },
    work_start_time: { type: String, default: "" },
    work_end_time: { type: String, default: "" },
    order_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "order" },
    cancellation_reason: { type: String, default: "", trim: true },
    rejection_reason: { type: String, default: "", trim: true },
    quote_description: { type: String, default: "", trim: true },
    /** Internal admin-only notes; optional. */
    admin_description: { type: String, default: null, trim: true },
    history: { type: [quoteHistoryEventSchema], default: [] },
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
