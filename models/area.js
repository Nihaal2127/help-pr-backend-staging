const mongoose = require('mongoose');

const areaSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        city_id: { type: mongoose.Schema.Types.ObjectId, ref: 'city', required: true },
        state_id: { type: mongoose.Schema.Types.ObjectId, required: true },
        state_name: { type: String, required: true },
        is_active: { type: Boolean, default: null },
        pincodes: { type: [String], default: [] },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false,
    }
);

areaSchema.index({ city_id: 1 });
areaSchema.index({ state_id: 1 });

module.exports = mongoose.model('area', areaSchema);
