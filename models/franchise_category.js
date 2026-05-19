const mongoose = require('mongoose');

/**
 * Local franchise preference per global category.
 * `is_active` in DB = is_enabled (NOT effective visibility; see catalog_availability_resolver).
 */
const franchiseCategoryEntrySchema = new mongoose.Schema(
    {
        category_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'category',
            required: true,
        },
        is_active: { type: Boolean, default: false },
    },
    { _id: false }
);

const franchiseCategorySchema = new mongoose.Schema(
    {
        franchise_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'franchise',
            required: true,
        },
        categories_list: {
            type: [franchiseCategoryEntrySchema],
            default: [],
        },
        /** @deprecated Derived from categories_list for API compat — not source of truth. */
        active_categories: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'category' }],
            default: [],
        },
        /** @deprecated Derived from categories_list for API compat — not source of truth. */
        inactive_categories: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'category' }],
            default: [],
        },
        /** Display order: every category_id in categories_list appears exactly once, in client payload order. */
        categories_order: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'category' }],
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

franchiseCategorySchema.index({ franchise_id: 1 });
franchiseCategorySchema.index({ deleted_at: 1 });

module.exports = mongoose.model('franchise_category', franchiseCategorySchema);
