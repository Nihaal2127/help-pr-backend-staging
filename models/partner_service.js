const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

var schema = mongoose.Schema;

var partnerServiceSchema = new schema(
    {
        partner_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
        category_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'category' },
        service_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'service' },
        is_accept_request: { type: Boolean, default: false },

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
