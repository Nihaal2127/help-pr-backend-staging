const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    franchise_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "franchise"
    },
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "expense_category"
    },
    subcategory_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "expense_subcategory"
    },
    expense_name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    expense_amount: { type: Number, required: true },
    expense_date: { type: Date, required: true },
    payment_mode: { type: String, required: true, trim: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null }
  },
  {
    timestamps: false
  }
);

expenseSchema.index({ franchise_id: 1, deleted_at: 1 });
expenseSchema.index({ category_id: 1, deleted_at: 1 });
expenseSchema.index({ subcategory_id: 1, deleted_at: 1 });
expenseSchema.index({ expense_name: 1, deleted_at: 1 });

module.exports = mongoose.model("expense", expenseSchema);
