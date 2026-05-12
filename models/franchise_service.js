const mongoose = require('mongoose');

const franchiseServiceEntrySchema = new mongoose.Schema(
    {
        service_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'service',
            required: true,
        },
        is_active: { type: Boolean, default: false },
    },
    { _id: false }
);

const franchiseServiceSchema = new mongoose.Schema(
    {
        franchise_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'franchise',
            required: true,
        },
        services_list: {
            type: [franchiseServiceEntrySchema],
            default: [],
        },
        active_services: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'service' }],
            default: [],
        },
        inactive_services: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'service' }],
            default: [],
        },
        /** Display order: every service_id in services_list appears exactly once, in client payload order. */
        services_order: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'service' }],
            default: [],
        },
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
    