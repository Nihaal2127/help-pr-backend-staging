const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        service_id: { type: String, required: false,default:""},
        desc: { type: String, required: true },
        tax: { type: Number, required: false, default: 0 },
        commission: { type: Number, required: false, default: 0 },
        payment_type: { type: String, required: false, default: "" },
        minimum_deposit: { type: Number, required: false, default: 0 },
        category_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'category' },
        image_url: { type: String, required: true, default: "" },
        is_active: { type: Boolean, default: true },
        is_request: { type: Boolean, default: false },
        approval_status: { type: String, enum: ["approve", "pending", "rejected"], default: "pending" },
        rejection_reason: { type: String, default: null },
        requested_by: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            ref: 'user',
        },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
        rating_total: { type: Number, default: 0 },
        rating_count: { type: Number, default: 0 },
        average_rating: { type: Number, default: 0 },
    },
    {
        timestamps: false
    });

    serviceSchema.index({ name: 1 });
    serviceSchema.index({ is_active: 1 });
    serviceSchema.index({ category_id: 1 });
    serviceSchema.index({ service_id: 1 });
    serviceSchema.index({ is_request: 1 });
    serviceSchema.index({ requested_by: 1 });

module.exports = mongoose.model('service', serviceSchema);