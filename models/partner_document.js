const mongoose = require("mongoose");

var schema = mongoose.Schema;

var partnerDocumentSchema = new schema(
  {
    partner_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
    document_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'document' },
    // document_images: { type: [String], default: [] },
    document_image: { type: String, default: "" },
    verification_status: { type: Number, default: 1 },
    /*
      1 for Pending
      2 for Verified
      3 for Reject
    */
    // submitted_at: { type: Date, default: null },
    // verified_at: { type: Date, default: null },
    rejected_reasone: { type: String, default: '' },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);

partnerDocumentSchema.index({ partner_id: 1 });
partnerDocumentSchema.index({ verification_status: 1 });

module.exports = mongoose.model("partner_document", partnerDocumentSchema);
