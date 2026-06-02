const mongoose = require('mongoose');
const Franchise = require('../models/franchise');
const Address = require('../models/address');
const { USER_TYPE_PARTNER, USER_TYPE_CUSTOMER } = require('../constants/user_types');
const User = require('../models/user');

const fail = (status, message) => ({ ok: false, status, message });
const pass = () => ({ ok: true });

const toObjectId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    return null;
  }
  return new mongoose.Types.ObjectId(String(value));
};

/** ObjectId, string id, or populated `{ _id }` from QUOTE_MOBILE_DETAIL_POPULATE */
const resolveRefId = (ref) => {
  if (ref == null) return null;
  if (typeof ref === 'object' && ref._id != null) return String(ref._id);
  if (typeof ref === 'object' && ref.id != null) return String(ref.id);
  return String(ref);
};

const assertCustomerOwnsQuote = (customerId, quote) => {
  if (!quote) {
    return fail(404, 'Quote not found.');
  }
  const quoteUserId = resolveRefId(quote.user_id);
  if (!quoteUserId || quoteUserId !== String(customerId)) {
    return fail(403, 'You are not allowed to access this quote.');
  }
  return pass();
};

const assertPartnerAssignedToQuote = (partnerId, quote) => {
  if (!quote) {
    return fail(404, 'Quote not found.');
  }
  const quotePartnerId = resolveRefId(quote.partner_id);
  if (!quotePartnerId || quotePartnerId !== String(partnerId)) {
    return fail(403, 'You are not assigned to this quote.');
  }
  return pass();
};

const assertFranchiseExists = async (franchiseId) => {
  const oid = toObjectId(franchiseId);
  if (!oid) {
    return fail(400, 'Valid franchise_id is required.');
  }
  const franchise = await Franchise.findOne({ _id: oid, deleted_at: null })
    .select('_id name')
    .lean();
  if (!franchise) {
    return fail(400, 'Franchise not found.');
  }
  return { ok: true, franchise };
};

const assertCustomerOwnsAddress = async (customerId, addressId) => {
  const oid = toObjectId(addressId);
  if (!oid) {
    return fail(400, 'Valid address_id is required.');
  }
  const address = await Address.findOne({
    _id: oid,
    user_id: customerId,
    deleted_at: null,
  }).lean();
  if (!address) {
    return fail(400, 'Address not found.');
  }
  return { ok: true, address };
};

const assertPartnerUser = async (partnerId) => {
  const oid = toObjectId(partnerId);
  if (!oid) {
    return fail(400, 'Valid partner_id is required.');
  }
  const partner = await User.findOne({
    _id: oid,
    deleted_at: null,
    type: USER_TYPE_PARTNER,
  })
    .select('_id type')
    .lean();
  if (!partner) {
    return fail(400, 'Partner not found.');
  }
  return { ok: true, partner };
};

const assertCallerIsPartner = (decodedUser) => {
  if (!decodedUser || Number(decodedUser.type) !== USER_TYPE_PARTNER) {
    return fail(403, 'This account is not a partner. Use the partner app to access this resource.');
  }
  return pass();
};

const assertCallerIsCustomer = (decodedUser) => {
  if (!decodedUser || Number(decodedUser.type) !== USER_TYPE_CUSTOMER) {
    return fail(403, 'This account is not a customer.');
  }
  return pass();
};

module.exports = {
  toObjectId,
  assertCustomerOwnsQuote,
  assertPartnerAssignedToQuote,
  assertFranchiseExists,
  assertCustomerOwnsAddress,
  assertPartnerUser,
  assertCallerIsPartner,
  assertCallerIsCustomer,
};
