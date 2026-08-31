const mongoose = require('mongoose');

const appleIapTransactionSchema = new mongoose.Schema(
    {
        partner_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            required: true,
            index: true,
        },
        change_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'partner_subscription_change',
            default: null,
        },
        transaction_id: { type: String, required: true, trim: true },
        original_transaction_id: { type: String, required: true, trim: true, index: true },
        product_id: { type: String, required: true, trim: true },
        bundle_id: { type: String, required: true, trim: true },
        environment: { type: String, default: null, trim: true },
        expires_at: { type: Date, default: null },
        purchase_date: { type: Date, default: null },
        notification_uuid: { type: String, default: null, trim: true },
        notification_type: { type: String, default: null, trim: true },
        notification_subtype: { type: String, default: null, trim: true },
        source: {
            type: String,
            enum: ['verify', 'restore', 'notification'],
            default: 'verify',
        },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    { timestamps: false }
);

appleIapTransactionSchema.index(
    { transaction_id: 1 },
    {
        unique: true,
        partialFilterExpression: {
            deleted_at: null,
            transaction_id: { $gt: '' },
        },
    }
);
appleIapTransactionSchema.index(
    { notification_uuid: 1 },
    {
        unique: true,
        partialFilterExpression: {
            deleted_at: null,
            notification_uuid: { $gt: '' },
        },
    }
);

module.exports = mongoose.model('apple_iap_transaction', appleIapTransactionSchema);
