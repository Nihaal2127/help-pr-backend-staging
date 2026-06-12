const Address = require('../models/address');
const User = require('../models/user');

/**
 * Soft-delete an address document. Returns { ok, status, message }.
 */
const softDeleteAddressRecord = async (address) => {
  if (!address) {
    return { ok: false, status: 404, message: 'Address not found.' };
  }

  if (address.deleted_at) {
    return { ok: false, status: 400, message: 'Address is already deleted.' };
  }

  address.deleted_at = new Date();
  address.updated_at = new Date();
  await address.save();

  return { ok: true, status: 200, message: 'Address deleted successfully.' };
};

/**
 * When a user creates their first address, copy location onto the user profile.
 */
const syncUserProfileOnFirstAddress = async (userId, locationFields, addressLine) => {
  const existingAddressCount = await Address.countDocuments({
    user_id: userId,
    deleted_at: null,
  });

  if (existingAddressCount > 1) {
    return;
  }

  await User.updateOne(
    { _id: userId, deleted_at: null },
    {
      $set: {
        address: addressLine,
        state_id: locationFields.state_id,
        city_id: locationFields.city_id,
        area_id: locationFields.area_id,
        pincode: locationFields.pincode,
        updated_at: new Date(),
      },
    }
  );
};

module.exports = {
  softDeleteAddressRecord,
  syncUserProfileOnFirstAddress,
};
