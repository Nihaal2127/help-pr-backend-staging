const mongoose = require('mongoose');
const Address = require('../../../models/address');
const { resolveLocationFields: resolveLocationFieldsCore } = require('../../address_location_service');
const {
  softDeleteAddressRecord,
  syncUserProfileOnFirstAddress,
} = require('../../address_lifecycle_service');

const { fail, ok } = require('../../../utils/mobile_service_result');

const formatAddressRecord = (doc) => {
  const o = doc && doc.toObject ? doc.toObject() : { ...doc };
  return {
    _id: o._id,
    state_id: o.state_id,
    city_id: o.city_id,
    area_id: o.area_id,
    pincode: o.pincode,
    address: o.address,
    name: o.contact_name ?? '',
    phone_number: o.contact_number ?? '',
    state_name: o.state || null,
    city_name: o.city || null,
    area_name: o.area || null,
    address_status: o.address_status,
    deleted_at: o.deleted_at ?? null,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
};

const resolveLocationFields = async (body) => {
  const result = await resolveLocationFieldsCore(body);
  if (!result.ok) {
    return fail(result.status, result.message);
  }
  return result;
};

const addressMatchesSearch = (record, search) => {
  if (!search) return true;
  const term = String(search).trim().toLowerCase();
  if (!term) return true;

  const haystacks = [
    record.address,
    record.pincode,
    record.name,
    record.phone_number,
    record.state_name,
    record.city_name,
    record.area_name,
  ];

  return haystacks.some((value) => String(value ?? '').toLowerCase().includes(term));
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

const listAddresses = async (customerId, { search } = {}) => {
  try {
    const normalizedSearch =
      search !== undefined && search !== null ? String(search).trim() : '';

    const rows = await Address.find({ user_id: customerId, deleted_at: null })
      .sort({ created_at: -1 })
      .lean();

    const formatted = rows.map(formatAddressRecord);
    const data =
      normalizedSearch === ''
        ? formatted
        : formatted.filter((record) => addressMatchesSearch(record, normalizedSearch));

    return ok(200, {
      message: 'Addresses fetched successfully.',
      data,
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

    const addressLine = String(body.address).trim();
    const row = await Address.create({
      user_id: customerId,
      contact_name: String(body.name).trim(),
      contact_number: String(body.phone_number).trim(),
      address: addressLine,
      landmark: '',
      ...locationResult.fields,
      address_status: true,
    });

    await syncUserProfileOnFirstAddress(customerId, locationResult.fields, addressLine);

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

    if (body.name !== undefined) {
      row.contact_name = String(body.name).trim();
    }
    if (body.phone_number !== undefined) {
      row.contact_number = String(body.phone_number).trim();
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

    const deleteResult = await softDeleteAddressRecord(row);
    if (!deleteResult.ok) {
      return fail(deleteResult.status, deleteResult.message);
    }

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
