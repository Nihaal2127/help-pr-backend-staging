const mongoose = require("mongoose");

var schema = mongoose.Schema;

var orderSchema = new schema(
  {
    unique_id: { type: String, default: '', trim: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
    user_unique_id: { type: String, default: '', trim: true },
    type: { type: Number, default: 2, required: true },
    city_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'city' },
    category_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'category' },
    order_status: { type: Number, default: 1, require: false },
    order_status_info: {
      type: [
        {
          status: {
            type: Number,  // Storing order status as a number
            required: true
          },
          updated_at: {
            type: Date,
            default: null
          }
        }
      ],
      default: []
    },
    address: { type: String, default: '', require: true },
    cancellation_reasone: { type: String, default: '', require: false },
    is_paid: { type: Boolean, default: false },
    payment_mode_id: { type: String, default: '', trim: true },
    transaction_id: { type: String, default: '', trim: true },
    created_by_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
    service_items: { type: [mongoose.Schema.Types.ObjectId], default: [], ref: 'order_service' },
    comments: { type: String, default: '', trim: true },
    order_date: { type: Date, default: null },

    sub_total: { type: Number, default: 0, require: true },
    tax: { type: Number, default: 0, require: true },
    discount_amount: { type: Number, default: null },
    user_paltform_fee: { type: Number, default: 0, require: true },
    partner_commison_platform_fee: { type: Number, default: 0, require: true },
    total_price: { type: Number, default: 0, require: true },
    admin_earning: { type: Number, default: 0, require: true },


    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);


orderSchema.index({ user_id: 1 });
orderSchema.index({ city_id: 1 });
orderSchema.index({ category_id: 1 });
orderSchema.index({ order_status: 1 });
orderSchema.index({ is_paid: 1 });


module.exports = mongoose.model("order", orderSchema);
