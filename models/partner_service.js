const mongoose = require("mongoose");

var schema = mongoose.Schema;

var partnerServiceSchema = new schema(
    {
        partner_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
        category_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'category' },
        service_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'service' },
        is_accept_request: { type: Boolean, default: false },

        description: { type: String, default: '' },
        tax: { type: Number, default: 0 },
        minimum_deposit: { type: Number, default: 0 },
        payment_type: { type: String, default: '', trim: true },
        price: { type: Number, default: 0 },
        commission: { type: Number, default: 0 },
        /** Local partner offering preference (is_enabled); effective visibility is resolver-computed. */
        is_active: { type: Boolean, default: true },

        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false,
    }
);


partnerServiceSchema.index({ partner_id: 1, service_id: 1, deleted_at: 1 }, { unique: true });
partnerServiceSchema.index({ partner_id: 1 });
partnerServiceSchema.index({ service_id: 1 });
partnerServiceSchema.index({ is_accept_request: 1 });


module.exports = mongoose.model("partner_service", partnerServiceSchema);
