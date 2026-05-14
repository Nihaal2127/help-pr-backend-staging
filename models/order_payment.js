const mongoose = require("mongoose");

const schema = mongoose.Schema;

const orderPaymentSchema = new schema(
  {
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "order",
      index: true,
    },
    /** customer = payer is customer; partner = payout / partner-side payment */
    payer_type: {
      type: String,
      required: true,
      enum: ["customer", "partner"],
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    payment_method: { type: String, default: "", trim: true },
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "completed", "failed", "refunded"],
      index: true,
    },
    transaction_reference: { type: String, default: "", trim: true },
    installment_index: { type: Number, default: null },
    due_date: { type: Date, default: null },
    paid_at: { type: Date, default: null },
    notes: { type: String, default: "", trim: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: false }
);

orderPaymentSchema.index({ order_id: 1, payer_type: 1, deleted_at: 1 });

module.exports = mongoose.model("order_payment", orderPaymentSchema);
