const mongoose = require("mongoose");

const expenseSubcategorySchema = new mongoose.Schema(
  {
    sub_category_name: { type: String, required: true, trim: true },
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "expense_category"
    },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null }
  },
  {
    timestamps: false
  }
);

module.exports = mongoose.model("expense_subcategory", expenseSubcategorySchema);
