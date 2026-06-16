const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    unique_id: { type: String, default: "", trim: true },
    title: { type: String, default: "", trim: true },

    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "order",
    },
    order_unique_id: { type: String, default: "", trim: true },

    user_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    partner_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    partner_name: { type: String, default: "", trim: true },
    employee_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "user" },
    franchise_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "franchise",
    },

    service_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "service" },
    service_name: { type: String, default: "", trim: true },

    service_date: { type: Date, default: null },
    start_time: { type: Date, default: null },
    end_time: { type: Date, default: null },

    status: {
      type: String,
      default: null,
      trim: true,
    },

    source: {
      type: String,
      default: "manual",
      enum: ["auto", "manual"],
      trim: true,
    },

    created_by_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "user",
    },

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);

appointmentSchema.index({ order_id: 1, source: 1, deleted_at: 1 });
appointmentSchema.index({ order_id: 1, deleted_at: 1 });
appointmentSchema.index({ franchise_id: 1, service_date: 1, deleted_at: 1 });
appointmentSchema.index({ service_date: 1, start_time: 1, deleted_at: 1 });
appointmentSchema.index({ unique_id: 1 });

module.exports = mongoose.model("appointment", appointmentSchema);
