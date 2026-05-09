const mongoose = require('mongoose');

const PLAN_NAMES = ['basic', 'silver', 'gold', 'platinum'];
const DURATION_TYPES = ['days', 'months'];

const subscriptionPlanSchema = new mongoose.Schema(
    {
        plan_name: {
            type: String,
            required: true,
            enum: PLAN_NAMES,
        },
        plan_description: { type: String, required: true },
        price: { type: Number, required: true },
        duration: { type: Number, required: true },
        duration_type: {
            type: String,
            required: true,
            enum: DURATION_TYPES,
        },
        priority: { type: Number, default: null },
        is_active: { type: Boolean, required: true },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false,
    }
);

subscriptionPlanSchema.index({ plan_name: 1 });
subscriptionPlanSchema.index({ is_active: 1 });
subscriptionPlanSchema.index({ deleted_at: 1 });
subscriptionPlanSchema.index({ priority: 1 });

module.exports = mongoose.model('subscription_plan', subscriptionPlanSchema);
module.exports.PLAN_NAMES = PLAN_NAMES;
module.exports.DURATION_TYPES = DURATION_TYPES;
