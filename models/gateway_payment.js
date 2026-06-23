const mongoose = require('mongoose');

const GATEWAYS = ['razorpay'];
const PAYER_TYPES = ['partner', 'customer'];
const STATUSES = ['pending', 'completed', 'failed', 'refunded'];
const PURPOSES = ['order', 'subscription_change'];
const INSTRUMENT_TYPES = ['card', 'upi', 'netbanking', 'wallet', 'emi', 'other'];

const gatewayPaymentSchema = new mongoose.Schema(
    {
        gateway: {
            type: String,
            required: true,
            enum: GATEWAYS,
            default: 'razorpay',
        },
        purpose: {
            type: String,
            required: true,
            enum: PURPOSES,
            index: true,
        },
        reference_id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        payer_type: {
            type: String,
            required: true,
            enum: PAYER_TYPES,
        },
        payer_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            required: true,
            index: true,
        },
        amount: { type: Number, required: true, min: 0 },
        /** Cumulative amount refunded via Razorpay for this capture (INR). */
        refunded_amount: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'INR', trim: true },
        status: {
            type: String,
            required: true,
            enum: STATUSES,
            default: 'pending',
            index: true,
        },
        /** App-level label: online, etc. */
        payment_method: { type: String, default: 'online', trim: true },
        gateway_payment_link_id: { type: String, default: null, trim: true },
        gateway_payment_id: { type: String, default: null, trim: true },
        instrument_type: { type: String, default: null, trim: true },
        paid_at: { type: Date, default: null },
        notes: { type: String, default: '', trim: true },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    { timestamps: false }
);

gatewayPaymentSchema.index({ payer_id: 1, created_at: -1 });
gatewayPaymentSchema.index({ purpose: 1, reference_id: 1, deleted_at: 1 });
gatewayPaymentSchema.index(
    { gateway_payment_id: 1 },
    {
        unique: true,
        partialFilterExpression: {
            deleted_at: null,
            gateway_payment_id: { $gt: '' },
        },
    }
);

module.exports = mongoose.model('gateway_payment', gatewayPaymentSchema);
module.exports.GATEWAYS = GATEWAYS;
module.exports.PAYER_TYPES = PAYER_TYPES;
module.exports.STATUSES = STATUSES;
module.exports.PURPOSES = PURPOSES;
module.exports.INSTRUMENT_TYPES = INSTRUMENT_TYPES;
