const mongoose = require('mongoose');

const userHomeCountsSchema = new mongoose.Schema(
    {
        total_distance_travelled: { type: Number, default: 0 },
        served: { type: Number, default: 0 },
        consulted: { type: Number, default: 0 },
        captured: { type: Number, default: 0 },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
        deleted_at: { type: Date, default: null },
    },
    {
        timestamps: false
    });

module.exports = mongoose.model('user_home_counts', userHomeCountsSchema);