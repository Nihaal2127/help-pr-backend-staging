const mongoose = require("mongoose");

const contentManagementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null }
  },
  {
    timestamps: false
  }
);

contentManagementSchema.index({ title: 1 });
contentManagementSchema.index({ deleted_at: 1 });

module.exports = mongoose.model("content_management", contentManagementSchema);
