const mongoose = require("mongoose");

var schema = mongoose.Schema;

var bankccountSchema = new schema(
  {
    partner_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
    bank_name: { type: String, default: '' },
    account_holder_name: { type: String, default: '' },
    account_number: { type: String, default: '' },
    ifsc_code: { type: String, default: '' },
    branch_name: { type: String, default: '' },
    is_primary: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);

bankccountSchema.index({ partner_id: 1 });

module.exports = mongoose.model("bank_account", bankccountSchema);
