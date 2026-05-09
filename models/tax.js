const mongoose = require('mongoose');

const taxSchema = new mongoose.Schema(
    {
        user_platform_fee: { type: Number, default: true },
        partner_platform_fee: { type: Number, default: true },
        partner_commision_fee: { type: Number, default: true },
        tax_for_customer: { type: Number, default: true },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false
    });

module.exports = mongoose.model('tax', taxSchema);