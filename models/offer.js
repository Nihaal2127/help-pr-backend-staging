const mongoose = require('mongoose');

const OFFER_TYPES = ['percentage', 'fixed'];

const offerSchema = new mongoose.Schema(
    {
        unique_id: { type: String, trim: true },
        name: { type: String, required: true, trim: true },
        type: {
            type: String,
            required: true,
            enum: OFFER_TYPES,
        },
        value: { type: Number, required: true },
        admin_contribution: { type: Number, required: true },
        partner_contribution: { type: Number, required: true },
        start_date: { type: Date, required: true },
        end_date: { type: Date, required: true },
        is_active: { type: Boolean, required: true },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false,
        minimize: false,
    }
);

offerSchema.index({ unique_id: 1 });
offerSchema.index({ type: 1 });
offerSchema.index({ is_active: 1 });
offerSchema.index({ deleted_at: 1 });
offerSchema.index({ start_date: 1, end_date: 1 });

module.exports = mongoose.model('offers', offerSchema);
module.exports.OFFER_TYPES = OFFER_TYPES;
