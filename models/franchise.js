const mongoose = require('mongoose');

const franchiseSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        state_id: { type: mongoose.Schema.Types.ObjectId, ref: 'state', required: true },
        state_name: { type: String, required: true },
        city_id: { type: mongoose.Schema.Types.ObjectId, ref: 'city', required: true },
        city_name: { type: String, required: true },
        area_id: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'area' }], default: [] },
        area_name: { type: [String], default: [] },
        admin_id: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
        admin_name: { type: String, required: true },
        description: { type: String, default: '' },
        desc: { type: String, default: null },
        desc2: { type: String, default: null },
        contact: { type: String, default: '' },
        services: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'service' }],
            default: [],
        },
        categories: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'category' }],
            default: [],
        },
        is_active: { type: Boolean, required: true },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false,
    }
);

franchiseSchema.index({ state_id: 1 });
franchiseSchema.index({ city_id: 1 });
franchiseSchema.index({ admin_id: 1 });

module.exports = mongoose.model('franchise', franchiseSchema);
