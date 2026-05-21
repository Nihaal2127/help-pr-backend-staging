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
            default: null,
        },
        order_unique_id: { type: String, default: null, trim: true },
        /** Legacy link to archived financial_order collection; always null for new credits. */
        financial_order_id: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        payout_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'partner_payout',
            default: null,
        },
        order_payment_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'order_payment',
            default: null,
        },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    { timestamps: false }
);

/** One active credit per partner order_payment (payment-to-partner wallet model). */
partnerWalletLedgerSchema.index(
    { order_payment_id: 1, transaction_type: 1 },
    {
        unique: true,
        partialFilterExpression: {
            deleted_at: null,
            order_payment_id: { $type: 'objectId' },
            transaction_type: 'credit',
        },
    }
);
/** Payout withdrawals and legacy partner-payment debits. */
partnerWalletLedgerSchema.index(
    { order_payment_id: 1, transaction_type: 1 },
    {
        unique: true,
        partialFilterExpression: {
            deleted_at: null,
            order_payment_id: { $type: 'objectId' },
            transaction_type: 'debit',
        },
    }
);
partnerWalletLedgerSchema.index({ partner_id: 1, date: -1, deleted_at: 1 });
partnerWalletLedgerSchema.index({ franchise_id: 1, deleted_at: 1 });
partnerWalletLedgerSchema.index({ order_id: 1, deleted_at: 1 });

module.exports = mongoose.model('partner_wallet_ledger', partnerWalletLedgerSchema);
module.exports.TRANSACTION_TYPES = TRANSACTION_TYPES;
