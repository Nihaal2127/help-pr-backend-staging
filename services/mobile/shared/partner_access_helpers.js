const mongoose = require('mongoose');
const User = require('../../../models/user');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');
const { fail, ok } = require('../../../utils/mobile_service_result');

const assertActivePartner = async (partnerId, { select = '_id' } = {}) => {
  if (!partnerId || !mongoose.Types.ObjectId.isValid(String(partnerId))) {
    return fail(401, 'Invalid token.');
  }

  const partnerOid = new mongoose.Types.ObjectId(String(partnerId));
  const partner = await User.findOne({
    _id: partnerOid,
    type: USER_TYPE_PARTNER,
    deleted_at: null,
  })
    .select(select)
    .lean();

  if (!partner) {
    return fail(404, 'Partner not found.');
  }

  return ok(200, { partner, partnerOid });
};

const VERIFICATION_STATUS_APPROVED = 2;

const assertVerifiedPartner = async (
  partnerId,
  { select = '_id franchise_id verification_status' } = {}
) => {
  const partnerResult = await assertActivePartner(partnerId, { select });
  if (!partnerResult.ok) {
    return partnerResult;
  }

  if (Number(partnerResult.data.partner.verification_status) !== VERIFICATION_STATUS_APPROVED) {
    return fail(
      403,
      'Catalog, services, and bank details can only be updated after your account is verified and approved.'
    );
  }

  return ok(200, {
    partnerOid: partnerResult.data.partnerOid,
    partner: partnerResult.data.partner,
  });
};

const loadPartnerFranchiseId = async (partnerId) => {
  const partnerResult = await assertActivePartner(partnerId, { select: 'franchise_id' });
  if (!partnerResult.ok) {
    return partnerResult;
  }

  const franchiseId = partnerResult.data.partner.franchise_id;
  if (!franchiseId) {
    return fail(
      400,
      'Partner is not linked to a franchise. Complete your location on profile first.'
    );
  }

  return ok(200, {
    franchiseId,
    partnerOid: partnerResult.data.partnerOid,
  });
};

module.exports = {
  assertActivePartner,
  assertVerifiedPartner,
  loadPartnerFranchiseId,
};
