const mongoose = require("mongoose");

var schema = mongoose.Schema;

var ticketSchema = new schema(
  {
    unique_id: { type: String, default: '',trim:true },
    created_by_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
    resolve_by_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
    user_unique_id: { type: String, default: "", require: true },
    resolver_unique_id: { type: String, default: "", require: true },

    status: { type: Number, default: 1, require: false },//1 for Open 2 for Close
    resolve_status: { type: Number, default: 1, require: false },//1 for pending 2 for resolve 3 for unresolve
    

    created_by_name: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    phone_number: { type: String, default: '', trim: true },
    query: { type: String, default: '', trim: true },
    contact_type: { type: Number, default: 0, require: false },//1 for Mail 2 for Call
    
    resolved_by_name: { type: String, default: '', trim: true },
    

    close_date: { type: Date, default: null },
    description: { type: String, default: "", require: false,trim:true },
    
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);


ticketSchema.index({ unique_id: 1 });
ticketSchema.index({ created_by_id: 1 });
ticketSchema.index({ resolve_by_id: 1 });
ticketSchema.index({ user_unique_id: 1 });
ticketSchema.index({ employee_unique_id: 1 });
ticketSchema.index({ status: 1 });
ticketSchema.index({ resolve_status: 1 });


module.exports = mongoose.model("ticket", ticketSchema);
