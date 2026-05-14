const mongoose = require("mongoose");

var schema = mongoose.Schema;

var addressSchema = new schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
    contact_name: { type: String, default: '' },
    contact_number: { type: String, default: '' },
    address: { type: String, default: '' },
    landmark: { type: String, default: '' },
    area: { type: String, default: '' },
    area_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'area' },
    city_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'city' },
    state_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'state' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    pincode: { type: String, default: '' },
    address_status: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);

addressSchema.index({ user_id: 1 });
addressSchema.index({ city_id: 1 });
addressSchema.index({ area_id: 1 });

module.exports = mongoose.model("address", addressSchema);
