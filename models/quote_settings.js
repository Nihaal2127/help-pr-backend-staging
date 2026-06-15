const mongoose = require('mongoose');

const quoteSettingsSchema = new mongoose.Schema(
    {
        free_quotes_per_user: { type: Number, default: 0 },
        no_of_quotes: { type: Number, default: 0 },
        quotes_price: { type: Number, default: 0 },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false,
    }
);

module.exports = mongoose.model('quote_settings', quoteSettingsSchema);
