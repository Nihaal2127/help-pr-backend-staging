/** Partner user verification_status: 1 pending, 2 approved, 3 rejected */

const PARTNER_VERIFICATION_REJECTED = 3;
const PARTNER_VERIFICATION_PENDING = 1;

/**
 * Fields to set on partner_document when its image is replaced.
 * Only resets per-document verification when the partner was rejected.
 */
function partnerDocumentFieldsAfterImageUpload(partnerVerificationStatus) {
  if (Number(partnerVerificationStatus) === PARTNER_VERIFICATION_REJECTED) {
    return {
      verification_status: PARTNER_VERIFICATION_PENDING,
      rejection_reason: '',
      rejected_reasone: '',
    };
  }
  return {};
}

/**
 * Updates partner user after document upload.
 * Rejected (3) → pending (1). Approved (2) and other statuses unchanged.
 * @returns {boolean} true if caller should save the user document
 */
function applyPartnerUserStatusAfterDocumentUpload(user) {
  if (!user || Number(user.verification_status) !== PARTNER_VERIFICATION_REJECTED) {
    return false;
  }
  user.verification_status = PARTNER_VERIFICATION_PENDING;
  user.is_active = false;
  user.submitted_at = Date.now();
  user.rejected_reasone = '';
  return true;
}

module.exports = {
  PARTNER_VERIFICATION_REJECTED,
  PARTNER_VERIFICATION_PENDING,
  partnerDocumentFieldsAfterImageUpload,
  applyPartnerUserStatusAfterDocumentUpload,
};
