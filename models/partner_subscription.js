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
        notes: { type: String, default: '' },
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

module.exports = mongoose.model('partner_subscription', partnerSubscriptionSchema);
module.exports.STATUS = STATUS;
