const mongoose = require("mongoose");

const schema = mongoose.Schema;

const orderAdditionalChargeSchema = new schema(
  {
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "order",
      index: true,
    },
    label: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    /** Pre-tax charge amount */
    amount: { type: Number, required: true, min: 0 },
    /** Snapshotted from order.tax_percent when charge is created */
    tax_percent: { type: Number, default: 0 },
    tax_amount: { type: Number, default: 0 },
    /** amount + tax_amount */
    total_amount: { type: Number, default: 0 },
    /** How this charge was collected / recorded: cash, upi, card, online, bank_transfer, other */
    payment_method: {
      type: String,
      default: "other",
      trim: true,
    },
    /** e.g. material, transport, labour, fee */
    charge_type: { type: String, default: "misc", trim: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: false }
);

orderAdditionalChargeSchema.index({ order_id: 1, deleted_at: 1 });

module.exports = mongoose.model("order_additional_charge", orderAdditionalChargeSchema);
