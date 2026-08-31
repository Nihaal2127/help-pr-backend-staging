const mongoose = require('mongoose');

const STATUS = ['active', 'expired', 'cancelled'];

const partnerSubscriptionSchema = new mongoose.Schema(
    {
        partner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
        subscription_plan_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'subscription_plan',
            required: true,
        },
        started_at: { type: Date, required: true, default: Date.now },
        expires_at: { type: Date, default: null },
        status: {
            type: String,
            required: true,
            enum: STATUS,
            default: 'active',
        },
        assigned_by_id: { type: mongoose.Schema.Types.ObjectId, ref: 'user', default: null },
        /** Platinum-only promotional banner; kept on downgrade but hidden from customers until platinum again. */
        banner_image_url: { type: String, default: null, trim: true },
        notes: { type: String, default: '' },
        billing_source: {
            type: String,
            enum: ['admin', 'razorpay', 'apple_iap'],
            default: undefined,
        },
        apple_original_transaction_id: { type: String, default: null, trim: true },
        apple_product_id: { type: String, default: null, trim: true },
        apple_environment: { type: String, default: null, trim: true },
        apple_auto_renew_status: { type: Number, default: null },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false,
    }
);

partnerSubscriptionSchema.index({ partner_id: 1 });
partnerSubscriptionSchema.index({ subscription_plan_id: 1 });
partnerSubscriptionSchema.index({ status: 1 });
partnerSubscriptionSchema.index({ deleted_at: 1 });
partnerSubscriptionSchema.index({ partner_id: 1, status: 1, deleted_at: 1 });
partnerSubscriptionSchema.index(
    { apple_original_transaction_id: 1 },
    {
        unique: true,
        partialFilterExpression: {
            deleted_at: null,
            apple_original_transaction_id: { $gt: '' },
        },
    }
);

module.exports = mongoose.model('partner_subscription', partnerSubscriptionSchema);
module.exports.STATUS = STATUS;
