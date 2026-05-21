const mongoose = require('mongoose');

const ORDER_STATUS = ['completed', 'in_progress'];
const PARTNER_PAYMENT_STATUS = ['paid', 'unpaid', 'partially_paid', 'completed'];
const CUSTOMER_PAYMENT_STATUS = [
    'paid',
    'unpaid',
    'partially_paid',
    'refund',
    'partially_refund',
    'completed',
];

const financialOrderSchema = new mongoose.Schema(
    {
        order_unique_id: { type: String, required: true, trim: true },
        order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'order', default: null },
        franchise_id: { type: mongoose.Schema.Types.ObjectId, ref: 'franchise', default: null },
        user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
        user_name: { type: String, required: true, trim: true },
        partner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
        partner_name: { type: String, required: true, trim: true },
        service_name: { type: String, required: true, trim: true },
        service_date: { type: Date, required: true },
        total_price: { type: Number, required: true, default: 0 },
        commission_percentage: { type: Number, required: true, default: 0 },
        tax_percentage: { type: Number, required: true, default: 0 },
        customer_paid_amount: { type: Number, required: true, default: 0 },
        customer_pending_amount: { type: Number, required: true, default: 0 },
        total_service_amount: { type: Number, required: true, default: 0 },
        paid_to_partner: { type: Number, required: true, default: 0 },
        pending_to_partner: { type: Number, required: true, default: 0 },
        customer_payment_status: {
            type: String,
            enum: CUSTOMER_PAYMENT_STATUS,
            required: true,
        },
        partner_payment_status: {
            type: String,
            enum: PARTNER_PAYMENT_STATUS,
            required: true,
        },
        order_status: {
            type: String,
            enum: ORDER_STATUS,
            required: true,
        },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    { timestamps: false }
);

financialOrderSchema.index({ order_unique_id: 1 }, { unique: true, partialFilterExpression: { deleted_at: null } });
financialOrderSchema.index({ franchise_id: 1, deleted_at: 1 });
financialOrderSchema.index({ user_id: 1, deleted_at: 1 });
financialOrderSchema.index({ partner_id: 1, deleted_at: 1 });
financialOrderSchema.index({ service_date: 1, deleted_at: 1 });
financialOrderSchema.index({ order_status: 1, deleted_at: 1 });
financialOrderSchema.index({ customer_payment_status: 1, deleted_at: 1 });
financialOrderSchema.index({ partner_payment_status: 1, deleted_at: 1 });

module.exports = mongoose.model('financial_order', financialOrderSchema);
module.exports.ORDER_STATUS = ORDER_STATUS;
module.exports.PARTNER_PAYMENT_STATUS = PARTNER_PAYMENT_STATUS;
module.exports.CUSTOMER_PAYMENT_STATUS = CUSTOMER_PAYMENT_STATUS;
