const mongoose = require('mongoose');

const userHomeCountsSchema = new mongoose.Schema(
    {
        total_distance_travelled: { type: Number, default: true },
        served: { type: Number, default: true },
        consulted: { type: Number, default: true },
        captured: { type: Number, default: true },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false
    });

module.exports = mongoose.model('user_home_counts', userHomeCountsSchema);