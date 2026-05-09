const mongoose = require("mongoose");

const expenseCategorySchema = new mongoose.Schema(
  {
    franchise_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "franchise"
    },
    category_name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null }
  },
  {
    timestamps: false
  }
);

module.exports = mongoose.model("expense_category", expenseCategorySchema);
