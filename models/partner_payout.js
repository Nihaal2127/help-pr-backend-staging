const mongoose = require('mongoose');

const WALLET_STATUS = ['pending', 'completed'];
const PAYMENT_METHODS = ['upi', 'bank_transfer', 'cash', 'cheque', 'other'];

const partnerPayoutSchema = new mongoose.Schema(
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
        pay_now_amount: { type: Number, required: true, min: 0 },
        payment_method: {
            type: String,
            enum: PAYMENT_METHODS,
            required: true,
            trim: true,
        },
        description: { type: String, required: true, trim: true },
        wallet_status: {
            type: String,
            enum: WALLET_STATUS,
            default: 'completed',
        },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    { timestamps: false }
);

partnerPayoutSchema.index({ partner_id: 1, deleted_at: 1, created_at: -1 });
partnerPayoutSchema.index({ franchise_id: 1, deleted_at: 1 });

module.exports = mongoose.model('partner_payout', partnerPayoutSchema);
module.exports.WALLET_STATUS = WALLET_STATUS;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
