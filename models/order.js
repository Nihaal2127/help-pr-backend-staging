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
    chat_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "chat" },

    type: { type: Number, default: 2, required: true },
    city_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "city" },
    category_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "category" },
    service_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "service" },

    order_status: {
      type: String,
      default: "in-progress",
      enum: ["in-progress", "completed", "cancelled", "refunded"],
      trim: true,
    },
    order_status_info: {
      type: [
        {
          status: {
            type: String,
            required: true,
            trim: true,
          },
          updated_at: {
            type: Date,
            default: null,
          },
        },
      ],
      default: [],
    },

    /** Partner job progress: pending → in-progress → completed (independent until completion). */
    partner_work_status: {
      type: String,
      default: "pending",
      enum: ["pending", "in-progress", "completed"],
      trim: true,
    },
    partner_work_status_info: {
      type: [
        {
          status: {
            type: String,
            required: true,
            trim: true,
          },
          updated_at: {
            type: Date,
            default: null,
          },
          updated_by_id: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            ref: "user",
          },
          actor_role: {
            type: String,
            default: "",
            trim: true,
          },
        },
      ],
      default: [],
    },
    /** Proof-of-service images uploaded by partner on completion. */
    work_proof_image_urls: { type: [String], default: [] },
    work_completion_description: { type: String, default: "", trim: true, maxlength: 500 },
    work_completed_at: { type: Date, default: null },
    partner_post_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "partner_post",
    },

    /** Snapshot / legacy display address */
    address: { type: String, default: "", require: true },
    address_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "address" },

    cancellation_reasone: { type: String, default: "", require: false },
    rejection_reason: { type: String, default: "", trim: true },
    customer_description: { type: String, default: "", trim: true },
    /** Free-text job / order notes (parallel to quote.quote_description). */
    order_description: { type: String, default: "", trim: true },
    /** Internal admin-only notes; optional. */
    admin_description: { type: String, default: null, trim: true },
    /** Set when this order was created from a quote (convert flow or explicit link on create). */
    quote_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "quote" },

    is_paid: { type: Boolean, default: false },
    /**
     * Derived from customer order_payment rows: unpaid | paid | partially_paid | refund | partially_refund
     * @deprecated Prefer user_payment_status; kept in sync for older clients.
     */
    payment_status: {
      type: String,
      default: "unpaid",
      enum: ["unpaid", "paid", "partially_paid", "refund", "partially_refund"],
      trim: true,
    },
    /** Customer (user) payment rollup — same values as payment_status; updated by syncOrderPaymentStatus. */
    user_payment_status: {
      type: String,
      default: "unpaid",
      enum: ["unpaid", "paid", "partially_paid", "refund", "partially_refund"],
      trim: true,
    },
    customer_paid_amount: { type: Number, default: 0 },
    customer_refunded_amount: { type: Number, default: 0 },
    customer_net_paid: { type: Number, default: 0 },
    customer_due_amount: { type: Number, default: 0 },
    /**
     * Partner payout rollup from order_payment (payer_type partner):
     * unpaid | partially_paid | paid vs partner entitlement (earning + eligible extras).
     * partner_due_amount is entitlement minus partner_paid_amount (overview pending).
     */
    partner_payment_status: {
      type: String,
      default: "unpaid",
      enum: ["unpaid", "partially_paid", "paid"],
      trim: true,
    },
    partner_paid_amount: { type: Number, default: 0 },
    partner_due_amount: { type: Number, default: 0 },
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
    /** Base service charge for booked hours (from frontend). */
    total_service_charge: { type: Number, default: 0 },
    /** Snapshotted from service.commission at order time (%). */
    commission_percent: { type: Number, default: 0 },
    /** total_service_charge × commission_percent / 100 */
    commission_amount: { type: Number, default: 0 },

    sub_total: { type: Number, default: 0, require: true },
    /** Legacy: stores tax_amount for older clients; new orders use tax_percent + tax_amount. */
    tax: { type: Number, default: 0, require: true },
    /** Snapshotted from service.tax at order time (%). */
    tax_percent: { type: Number, default: 0 },
    /** sub_total × tax_percent / 100 */
    tax_amount: { type: Number, default: 0 },
    discount_amount: { type: Number, default: null },
    discount_percent: { type: Number, default: null },
    discount_code: { type: String, default: "", trim: true },
    discount_reason: { type: String, default: "", trim: true },
    /** Applied offer reference (optional). */
    offer_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "offers" },
    order_offer_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "order_offer" },

    user_paltform_fee: { type: Number, default: 0, require: true },
    partner_commison_platform_fee: { type: Number, default: 0, require: true },
    /** Sum of pre-tax additional charge amounts */
    additional_charges_subtotal: { type: Number, default: 0 },
    /** Sum of commission on additional charges (admin share per line) */
    additional_charges_commission: { type: Number, default: 0 },
    /** Sum of tax on additional charges */
    additional_charges_tax: { type: Number, default: 0 },
    /** Sum of active order_additional_charge total_amount; maintained by recalculateOrderTotals */
    additional_charges_total: { type: Number, default: 0 },
    /** Alias of commission_amount (reporting). */
    admin_commission: { type: Number, default: 0 },
    total_price: { type: Number, default: 0, require: true },
    admin_earning: { type: Number, default: 0, require: true },
    /** Snapshotted from service.minimum_deposit at order time (%). */
    minimum_deposit_percent: { type: Number, default: 0 },
    /** minimum_deposit_percent applied to final total_price */
    minimum_deposit_amount: { type: Number, default: 0 },
    /** Legacy alias of minimum_deposit_amount */
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
orderSchema.index({ partner_work_status: 1 });
orderSchema.index({ partner_id: 1, partner_work_status: 1, deleted_at: 1 });
orderSchema.index({ is_paid: 1 });
orderSchema.index({ payment_status: 1 });
orderSchema.index({ user_payment_status: 1 });
orderSchema.index({ partner_payment_status: 1 });
orderSchema.index({ address_id: 1 });
orderSchema.index({ service_id: 1 });
orderSchema.index({ quote_id: 1 });
orderSchema.index({ offer_id: 1 });
orderSchema.index({ order_offer_id: 1 });
orderSchema.index({ chat_id: 1 });

module.exports = mongoose.model("order", orderSchema);
