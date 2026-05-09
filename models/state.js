const mongoose = require('mongoose');

const stateSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        is_active: { type: Boolean, default:true},
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false
    });

stateSchema.index({ status: 1 });
module.exports = mongoose.model('state', stateSchema);