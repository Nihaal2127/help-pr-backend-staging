const mongoose = require('mongoose');

const orderRefundSchema = new mongoose.Schema(
    {
        order_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'order',
            required: true,
            index: true,
        },
        order_unique_id: { type: String, default: '', trim: true, index: true },
        franchise_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'franchise',
            default: null,
            index: true,
        },
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            default: null,
        },
        user_name: { type: String, required: true, trim: true },
        partner_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            default: null,
        },
        total_amount: { type: Number, required: true, min: 0 },
        user_paid: { type: Number, required: true, min: 0 },
        refund_amount: { type: Number, required: true, min: 0 },
        from_admin_commission: { type: Number, required: true, min: 0, default: 0 },
        from_partner_wallet: { type: Number, required: true, min: 0, default: 0 },
        refund_date: { type: Date, required: true, index: true },
        notes: { type: String, default: '', trim: true },
        created_by_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            default: null,
        },
        order_payment_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'order_payment',
            default: null,
        },
        /** manual = ledger only; razorpay = money returned via Razorpay API */
        refund_channel: {
            type: String,
            enum: ['manual', 'razorpay'],
            default: 'manual',
        },
        razorpay_refund_details: {
            type: [
                {
                    gateway_payment_id: { type: String, default: '', trim: true },
                    razorpay_refund_id: { type: String, default: '', trim: true },
                    amount: { type: Number, default: 0, min: 0 },
                },
            ],
            default: [],
        },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    { timestamps: false }
);

orderRefundSchema.index({ franchise_id: 1, deleted_at: 1, refund_date: -1 });
orderRefundSchema.index({ user_name: 1, deleted_at: 1 });
orderRefundSchema.index({ order_unique_id: 1, deleted_at: 1 });

module.exports = mongoose.model('order_refund', orderRefundSchema);
