const mongoose = require('mongoose');

const franchiseServiceSchema = new mongoose.Schema(
    {
        franchise_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'franchise',
            required: true,
        },
        services_list: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'service' }],
            default: [],
        },
        active_services: { type: Boolean, default: false },
        inactive_services: { type: Boolean, default: false },
        order_number: { type: Number, default: 0 },
        created_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
        updated_at: { type: Date, default: Date.now },
    },
    {
        timestamps: false,
    }
);

franchiseServiceSchema.index({ franchise_id: 1 });
franchiseServiceSchema.index({ deleted_at: 1 });

module.exports = mongoose.model('franchise_service', franchiseServiceSchema);
