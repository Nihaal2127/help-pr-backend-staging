const mongoose = require('mongoose');

const citySchema = new mongoose.Schema({
    name: { type: String, required: true },
    is_active: { type: Boolean, default:null },
    city_service_price: { type: Number, default:0 },
    state_name:{type:String,require:true ,default:null},
    state_id: {  type: mongoose.Schema.Types.ObjectId, required: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
}, 
{
    timestamps: false 
});
citySchema.index({state_id:1});
module.exports = mongoose.model('city', citySchema);