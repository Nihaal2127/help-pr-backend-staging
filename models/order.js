const mongoose = require("mongoose");

var schema = mongoose.Schema;

var orderSchema = new schema(
  {
    unique_id: { type: String, default: "", trim: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    user_unique_id: { type: String, default: "", trim: true },

    /** Same role as quote: primary partner on the job (also on order_service). */
    partner_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    employee_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    franchise_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "franchise" },

    type: { type: Number, default: 2, required: true },
    city_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "city" },
    category_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "category" },
    service_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "service" },

    order_status: { type: Number, default: 1, require: false },
    order_status_info: {
      type: [
        {
          status: {
            type: Number,
            required: true,
          },
          updated_at: {
            type: Date,
            default: null,
          },
        },
      ],
      default: [],
    },

    /** Snapshot / legacy display address */
    address: { type: String, default: "", require: true },
    address_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "address" },

    cancellation_reasone: { type: String, default: "", require: false },
    rejection_reason: { type: String, default: "", trim: true },
    customer_description: { type: String, default: "", trim: true },
    /** Free-text job / order notes (parallel to quote.quote_description). */
    order_description: { type: String, default: "", trim: true },
    /** Set when this order was created from a quote (convert flow or explicit link on create). */
    quote_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "quote" },

    is_paid: { type: Boolean, default: false },
    /** Legacy / integration id (e.g. Razorpay flow uses "2") */
    payment_mode_id: { type: String, default: "", trim: true },
    transaction_id: { type: String, default: "", trim: true },

    /** single | installments — how the order is paid over time */
    payment_schedule_type: {
      type: String,
      default: "single",
      enum: ["single", "installments"],
      trim: true,
    },
    /** cash | upi | card | online | bank_transfer | other — primary customer payment method label */
    customer_payment_method: { type: String, default: "", trim: true },

    created_by_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    // One order_service per order (new orders); array kept for backward compatibility with existing data.
    service_items: { type: [mongoose.Schema.Types.ObjectId], default: [], ref: "order_service" },
    comments: { type: String, default: "", trim: true },
    order_date: { type: Date, default: null },

    /** Quote-aligned schedule (order-level); service windows still on order_service */
    from_date: { type: Date, default: null },
    to_date: { type: Date, default: null },
    work_hours_per_day: { type: Number, default: 0 },
    total_work_hours: { type: Number, default: 0 },
    work_start_time: { type: String, default: "", trim: true },
    work_end_time: { type: String, default: "", trim: true },
    service_price: { type: Number, default: 0 },

    sub_total: { type: Number, default: 0, require: true },
    tax: { type: Number, default: 0, require: true },
    discount_amount: { type: Number, default: null },
    discount_percent: { type: Number, default: null },
    discount_code: { type: String, default: "", trim: true },
    discount_reason: { type: String, default: "", trim: true },

    user_paltform_fee: { type: Number, default: 0, require: true },
    partner_commison_platform_fee: { type: Number, default: 0, require: true },
    /** Sum of active order_additional_charge rows; maintained by recalculateOrderTotals */
    additional_charges_total: { type: Number, default: 0 },
    /** Platform commission amount for this order (reporting; not subtracted from total_price in helper) */
    admin_commission: { type: Number, default: 0 },
    total_price: { type: Number, default: 0, require: true },
    admin_earning: { type: Number, default: 0, require: true },
    min_deposit: { type: Number, default: 0 },

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);

orderSchema.index({ user_id: 1 });
orderSchema.index({ partner_id: 1 });
orderSchema.index({ franchise_id: 1 });
orderSchema.index({ city_id: 1 });
orderSchema.index({ category_id: 1 });
orderSchema.index({ order_status: 1 });
orderSchema.index({ is_paid: 1 });
orderSchema.index({ address_id: 1 });
orderSchema.index({ service_id: 1 });
orderSchema.index({ quote_id: 1 });

module.exports = mongoose.model("order", orderSchema);
