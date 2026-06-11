const mongoose = require('mongoose');

const TRANSACTION_TYPES = ['credit', 'debit'];

const partnerWalletLedgerSchema = new mongoose.Schema(
    {
        partner_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            required: true,
            index: true,
        },
        franchise_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'franchise',
            default: null,
            index: true,
        },
        transaction_type: {
            type: String,
            enum: TRANSACTION_TYPES,
            required: true,
            index: true,
        },
        amount: { type: Number, required: true, min: 0 },
        date: { type: Date, required: true },
        description: { type: String, required: true, trim: true },
        payment_method: { type: String, default: null, trim: true },
        order_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'order',
        },
        order_unique_id: { type: String, trim: true },
        /** Legacy link to archived financial_order collection; omit when unused. */
        financial_order_id: {
            type: mongoose.Schema.Types.ObjectId,
        },
        payout_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'partner_payout',
        },
        order_payment_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'order_payment',
        },
        subscription_change_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'partner_subscription_change',
        },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    { timestamps: false }
);

/** One active credit per order_payment row (order-payment wallet model only). */
partnerWalletLedgerSchema.index(
    { order_payment_id: 1, transaction_type: 1 },
    {
        unique: true,
        name: 'wallet_order_payment_credit_unique',
        partialFilterExpression: {
            deleted_at: null,
            transaction_type: 'credit',
            order_payment_id: { $exists: true, $type: 'objectId' },
        },
    }
);
/** One active debit per order_payment row (partner remittance / payout model). */
partnerWalletLedgerSchema.index(
    { order_payment_id: 1, transaction_type: 1 },
    {
        unique: true,
        name: 'wallet_order_payment_debit_unique',
        partialFilterExpression: {
            deleted_at: null,
            transaction_type: 'debit',
            order_payment_id: { $exists: true, $type: 'objectId' },
        },
    }
);
partnerWalletLedgerSchema.index({ partner_id: 1, date: -1, deleted_at: 1 });
partnerWalletLedgerSchema.index({ franchise_id: 1, deleted_at: 1 });
partnerWalletLedgerSchema.index({ order_id: 1, deleted_at: 1 });
partnerWalletLedgerSchema.index({ subscription_change_id: 1, deleted_at: 1 });

module.exports = mongoose.model('partner_wallet_ledger', partnerWalletLedgerSchema);
module.exports.TRANSACTION_TYPES = TRANSACTION_TYPES;
