const mongoose = require("mongoose");

var schema = mongoose.Schema;

var documentSchema = new schema(
  {
    name: { type: String, trim: true, default: null },
    is_optional: { type: Boolean, default: false },
    is_active: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);

documentSchema.index({ name: 1,deleted_at: 1 }, { unique: true });

module.exports = mongoose.model("document", documentSchema);
