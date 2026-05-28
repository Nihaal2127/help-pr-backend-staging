const mongoose = require('mongoose');
const Address = require('../../../models/address');
const State = require('../../../models/state');
const City = require('../../../models/city');
const Area = require('../../../models/area');
const User = require('../../../models/user');

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const formatAddressRecord = (doc) => {
  const o = doc && doc.toObject ? doc.toObject() : { ...doc };
  return {
    _id: o._id,
    state_id: o.state_id,
    city_id: o.city_id,
    area_id: o.area_id,
    pincode: o.pincode,
    address: o.address,
    state_name: o.state || null,
    city_name: o.city || null,
    area_name: o.area || null,
    address_status: o.address_status,
    deleted_at: o.deleted_at ?? null,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
};

const resolveLocationFields = async ({ state_id, city_id, area_id, pincode }) => {
  if (!mongoose.Types.ObjectId.isValid(String(state_id))) {
    return fail(400, 'Invalid state id.');
  }
  if (!mongoose.Types.ObjectId.isValid(String(city_id))) {
    return fail(400, 'Invalid city id.');
  }
  if (!mongoose.Types.ObjectId.isValid(String(area_id))) {
    return fail(400, 'Invalid area id.');
  }

  const stateOid = new mongoose.Types.ObjectId(String(state_id));
  const cityOid = new mongoose.Types.ObjectId(String(city_id));
  const areaOid = new mongoose.Types.ObjectId(String(area_id));
  const pincodeValue = String(pincode).trim();

  const state = await State.findOne({ _id: stateOid, deleted_at: null }).lean();
  if (!state) return fail(400, 'State not found.');
  if (state.is_active === false) return fail(400, 'State is not active.');

  const city = await City.findOne({ _id: cityOid, deleted_at: null }).lean();
  if (!city) return fail(400, 'City not found.');
  if (String(city.state_id) !== String(stateOid)) {
    return fail(400, 'City does not belong to the selected state.');
  }
  if (city.is_active === false) return fail(400, 'City is not active.');

  const area = await Area.findOne({ _id: areaOid, deleted_at: null }).lean();
  if (!area) return fail(400, 'Area not found.');
  if (String(area.city_id) !== String(cityOid)) {
    return fail(400, 'Area does not belong to the selected city.');
  }
  if (String(area.state_id) !== String(stateOid)) {
    return fail(400, 'Area does not belong to the selected state.');
  }
  if (area.is_active === false) return fail(400, 'Area is not active.');

  const areaPincodes = Array.isArray(area.pincodes)
    ? area.pincodes.map((p) => String(p).trim())
    : [];
  if (!areaPincodes.includes(pincodeValue)) {
    return fail(400, 'Pincode must be selected from the list for the chosen area.');
  }

  return {
    ok: true,
    fields: {
      state_id: stateOid,
      city_id: cityOid,
      area_id: areaOid,
      state: state.name,
      city: city.name,
      area: area.name,
      pincode: pincodeValue,
    },
  };
};

const findCustomerAddress = async (customerId, addressId) => {
  if (!mongoose.Types.ObjectId.isValid(String(addressId))) {
    return null;
  }
  return Address.findOne({
    _id: addressId,
    user_id: customerId,
    deleted_at: null,
  });
};

const listAddresses = async (customerId) => {
  try {
    const rows = await Address.find({ user_id: customerId, deleted_at: null })
      .sort({ created_at: -1 })
      .lean();

    return ok(200, {
      message: 'Addresses fetched successfully.',
      data: rows.map(formatAddressRecord),
    });
  } catch (err) {
    console.error('mobile user list addresses', err.message);
    return fail(500, 'Internal server error.');
  }
};

const createAddress = async (customerId, body) => {
  try {
    const locationResult = await resolveLocationFields(body);
    if (!locationResult.ok) {
      return locationResult;
    }

    const existingAddressCount = await Address.countDocuments({
      user_id: customerId,
      deleted_at: null,
    });

    const user = await User.findOne({
      _id: customerId,
      deleted_at: null,
    })
      .select('name phone_number')
      .lean();

    const addressLine = String(body.address).trim();
    const row = await Address.create({
      user_id: customerId,
      contact_name: user?.name ?? '',
      contact_number: user?.phone_number ?? '',
      address: addressLine,
      landmark: '',
      ...locationResult.fields,
      address_status: true,
    });

    if (existingAddressCount === 0) {
      await User.updateOne(
        { _id: customerId, deleted_at: null },
        {
          $set: {
            address: addressLine,
            state_id: locationResult.fields.state_id,
            city_id: locationResult.fields.city_id,
            area_id: locationResult.fields.area_id,
            pincode: locationResult.fields.pincode,
            updated_at: new Date(),
          },
        }
      );
    }

    return ok(200, {
      message: 'Address created successfully.',
      data: formatAddressRecord(row),
    });
  } catch (err) {
    console.error('mobile user create address', err.message);
    return fail(500, 'Internal server error.');
  }
};

const updateAddress = async (customerId, addressId, body) => {
  try {
    const row = await findCustomerAddress(customerId, addressId);
    if (!row) {
      return fail(404, 'Address not found.');
    }

    const merged = {
      state_id: body.state_id !== undefined ? body.state_id : row.state_id,
      city_id: body.city_id !== undefined ? body.city_id : row.city_id,
      area_id: body.area_id !== undefined ? body.area_id : row.area_id,
      pincode: body.pincode !== undefined ? body.pincode : row.pincode,
    };

    const locationResult = await resolveLocationFields(merged);
    if (!locationResult.ok) {
      return locationResult;
    }

    row.state_id = locationResult.fields.state_id;
    row.city_id = locationResult.fields.city_id;
    row.area_id = locationResult.fields.area_id;
    row.state = locationResult.fields.state;
    row.city = locationResult.fields.city;
    row.area = locationResult.fields.area;
    row.pincode = locationResult.fields.pincode;

    if (body.address !== undefined) {
      row.address = String(body.address).trim();
    }

    row.updated_at = new Date();
    await row.save();

    return ok(200, {
      message: 'Address updated successfully.',
      data: formatAddressRecord(row),
    });
  } catch (err) {
    console.error('mobile user update address', err.message);
    return fail(500, 'Internal server error.');
  }
};

const deleteAddress = async (customerId, addressId) => {
  try {
    const row = await findCustomerAddress(customerId, addressId);
    if (!row) {
      return fail(404, 'Address not found.');
    }

    if (row.deleted_at) {
      return fail(400, 'Address is already deleted.');
    }

    row.deleted_at = new Date();
    row.updated_at = new Date();
    await row.save();

    return ok(200, {
      message: 'Address deleted successfully.',
    });
  } catch (err) {
    console.error('mobile user delete address', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
};
