const mongoose = require('mongoose');

const franchiseCategorySchema = new mongoose.Schema(
    {
        franchise_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'franchise',
            required: true,
        },
        categories_list: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'category' }],
            default: [],
        },
        active_categories: { type: Boolean, default: false },
        inactive_categories: { type: Boolean, default: false },
        order_number: { type: Number, default: 0 },
        created_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
        updated_at: { type: Date, default: Date.now },
    },
    {
        timestamps: false,
    }
);

franchiseCategorySchema.index({ franchise_id: 1 });
franchiseCategorySchema.index({ deleted_at: 1 });

module.exports = mongoose.model('franchise_category', franchiseCategorySchema);
