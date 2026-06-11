const mongoose = require('mongoose');

const CHANGE_TYPES = ['upgrade', 'downgrade'];
const PAYMENT_METHODS = [
    'not_required',
    'wallet',
    'cash',
    'wallet_and_cash',
    'online',
    'wallet_and_online',
];
const PAYMENT_STATUSES = ['not_required', 'pending', 'completed', 'failed'];
const CHANGE_STATUSES = ['pending', 'completed', 'cancelled', 'expired'];

const partnerSubscriptionChangeSchema = new mongoose.Schema(
    {
        partner_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            required: true,
            index: true,
        },
        from_plan_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'subscription_plan',
            required: true,
        },
        to_plan_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'subscription_plan',
            required: true,
        },
        change_type: {
            type: String,
            required: true,
            enum: CHANGE_TYPES,
        },
        days_used: { type: Number, required: true, min: 0 },
        days_total: { type: Number, required: true, min: 1 },
        consumed_value: { type: Number, required: true, min: 0 },
        remaining_value: { type: Number, required: true, min: 0 },
        gross_new_plan_price: { type: Number, required: true, min: 0 },
        amount_to_pay: { type: Number, required: true, min: 0 },
        wallet_amount: { type: Number, default: 0, min: 0 },
        cash_amount: { type: Number, default: 0, min: 0 },
        wallet_credit: { type: Number, default: 0, min: 0 },
        payment_method: {
            type: String,
            enum: PAYMENT_METHODS,
            default: 'not_required',
        },
        payment_status: {
            type: String,
            enum: PAYMENT_STATUSES,
            default: 'not_required',
        },
        razorpay_payment_link_id: {
            type: String,
            default: null,
            trim: true,
            set: (value) => {
                if (value === undefined || value === null) return null;
                const trimmed = String(value).trim();
                return trimmed === '' ? null : trimmed;
            },
        },
        transaction_reference: { type: String, default: null, trim: true },
        wallet_ledger_debit_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'partner_wallet_ledger',
            default: null,
        },
        wallet_ledger_credit_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'partner_wallet_ledger',
            default: null,
        },
        status: {
            type: String,
            required: true,
            enum: CHANGE_STATUSES,
            default: 'completed',
        },
        applied_at: { type: Date, default: null },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    { timestamps: false }
);

partnerSubscriptionChangeSchema.index({ partner_id: 1, created_at: -1 });
partnerSubscriptionChangeSchema.index({ partner_id: 1, status: 1, deleted_at: 1 });
// No unique index on pending — DocumentDB/Lambda races caused E11000 with no visible row.
// Concurrency is handled in subscription_change_service via optimistic subscription update.
/** Only non-empty Razorpay link ids are unique (null/omitted rows are not indexed). */
partnerSubscriptionChangeSchema.index(
    { razorpay_payment_link_id: 1 },
    {
        unique: true,
        partialFilterExpression: {
            deleted_at: null,
            razorpay_payment_link_id: { $gt: '' },
        },
    }
);

module.exports = mongoose.model('partner_subscription_change', partnerSubscriptionChangeSchema);
module.exports.CHANGE_TYPES = CHANGE_TYPES;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
module.exports.CHANGE_STATUSES = CHANGE_STATUSES;
