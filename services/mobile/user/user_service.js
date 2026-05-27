const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../../../models/user');
const Area = require('../../../models/area');
const City = require('../../../models/city');
const Otp = require('../../../models/otp');
const notificationSetting = require('../../../models/notification_settings');
const { getNewId } = require('../../../helper/id_generator');
const { normalizeUserPhone } = require('../../../utils/user_contact_uniqueness');
const { USER_TYPE_CUSTOMER } = require('../../../constants/user_types');

const REGISTRATION_TYPE_NORMAL = 1;
const MOBILE_USER_OTP = '123456';
const OTP_EXPIRY_MS = 10 * 60 * 1000;

const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

const findOrCreateCustomer = async (phone_number) => {
  const normalizedPhone = normalizeUserPhone(phone_number);
  let user = await User.findOne({ phone_number: normalizedPhone, deleted_at: null });

  if (user) {
    if (Number(user.type) !== USER_TYPE_CUSTOMER) {
      return {
        ok: false,
        status: 409,
        message: 'This phone number is registered with another account type.',
      };
    }
    return { ok: true, user };
  }

  const registration_id = await getNewId(0);
  const user_id = await getNewId(USER_TYPE_CUSTOMER);
  const _id = new mongoose.Types.ObjectId();

  user = new User({
    _id,
    registration_id,
    user_id,
    phone_number: normalizedPhone,
    type: USER_TYPE_CUSTOMER,
    registration_type: REGISTRATION_TYPE_NORMAL,
    is_from_web: false,
    is_active: true,
  });

  await user.save();
  await notificationSetting.create({ user_id: user._id });

  return { ok: true, user };
};

const createMobileUserOtp = async (phone_number) => {
  const normalizedPhone = normalizeUserPhone(phone_number);
  await Otp.deleteMany({ phone_number: normalizedPhone });
  return Otp.create({
    phone_number: normalizedPhone,
    otp: hashOtp(MOBILE_USER_OTP),
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
  });
};

const sendOtp = async ({ phone_number }) => {
  const customerResult = await findOrCreateCustomer(phone_number);
  if (!customerResult.ok) {
    return customerResult;
  }

  await createMobileUserOtp(phone_number);

  return {
    ok: true,
    status: 200,
    message: 'OTP sent successfully.',
  };
};

const buildCustomerLoginData = async (user) => {
  const populated = await User.findById(user._id).populate([{ path: 'city_id', select: 'name' }]).lean();
  if (!populated) return null;

  const data = {
    ...populated,
    city_id: populated?.city_id?._id ?? populated?.city_id ?? null,
    city_name: populated?.city_id?.name ?? null,
  };
  delete data.password;
  return data;
};

const verifyOtpAndLogin = async ({ phone_number, device_token, validOtp }) => {
  const normalizedPhone = normalizeUserPhone(phone_number);
  const user = await User.findOne({
    phone_number: normalizedPhone,
    type: USER_TYPE_CUSTOMER,
    deleted_at: null,
  });

  if (!user) {
    return { ok: false, status: 401, message: 'Invalid credentials.' };
  }

  if (user.is_blocked === true) {
    return {
      ok: false,
      status: 403,
      message: 'Your account is blocked. Please contact support.',
    };
  }

  if (device_token !== undefined && device_token !== null && String(device_token).trim() !== '') {
    user.device_token = String(device_token).trim();
  }

  user.generateAuthToken();
  await user.save();
  await Otp.deleteOne({ _id: validOtp._id });

  const data = await buildCustomerLoginData(user);
  if (!data) {
    return { ok: false, status: 500, message: 'Failed to load user profile.' };
  }

  return {
    ok: true,
    status: 200,
    message: 'OTP verified successfully.',
    data,
  };
};

const MOBILE_USER_ALLOWED_UPDATE_FIELDS = ['name', 'phone_number', 'email', 'date_of_birth', 'gender'];

const updateUser = async ({ customerId, body }) => {
  const user = await User.findOne({
    _id: customerId,
    type: USER_TYPE_CUSTOMER,
    deleted_at: null,
  });

  if (!user) {
    return { ok: false, status: 404, message: 'Customer not found.' };
  }

  if (user.is_blocked === true) {
    return {
      ok: false,
      status: 403,
      message: 'Your account is blocked. Please contact support.',
    };
  }

  for (const field of MOBILE_USER_ALLOWED_UPDATE_FIELDS) {
    if (body[field] !== undefined) {
      user[field] = body[field];
    }
  }

  user.updated_at = new Date();
  await user.save();

  const data = await buildCustomerLoginData(user);
  if (!data) {
    return { ok: false, status: 500, message: 'Failed to load user profile.' };
  }

  return {
    ok: true,
    status: 200,
    message: 'User updated successfully.',
    data,
  };
};

const sanitizeCsvField = (value) => String(value ?? '').replace(/,/g, ' ').trim();

const normalizeAreaPincodes = (pincodes) => {
  if (!pincodes || !Array.isArray(pincodes)) return [];
  return [...new Set(pincodes.map((p) => String(p).trim()).filter(Boolean))];
};

const listAllPincodes = async ({ search } = {}) => {
  try {
    const normalizedSearch =
      search !== undefined && search !== null ? String(search).trim().toLowerCase() : '';

    const areas = await Area.find({ deleted_at: null })
      .select('name pincodes city_id state_name')
      .lean();

    const cityIds = [
      ...new Set(
        areas
          .map((area) => area.city_id && area.city_id.toString())
          .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      ),
    ].map((id) => new mongoose.Types.ObjectId(id));

    const cities = await City.find({ _id: { $in: cityIds }, deleted_at: null })
      .select('name')
      .lean();
    const cityNameById = new Map(cities.map((city) => [city._id.toString(), city.name]));

    const records = [];
    for (const area of areas) {
      const areaName = sanitizeCsvField(area.name);
      const cityName = sanitizeCsvField(cityNameById.get(String(area.city_id)) || '');
      const stateName = sanitizeCsvField(area.state_name);
      for (const pincode of normalizeAreaPincodes(area.pincodes)) {
        records.push({
          pincode,
          area_name: areaName,
          city_name: cityName,
          state_name: stateName,
        });
      }
    }

    const filteredRecords =
      normalizedSearch === ''
        ? records
        : records.filter((r) => {
            const pincode = String(r.pincode || '').toLowerCase();
            const area = String(r.area_name || '').toLowerCase();
            const city = String(r.city_name || '').toLowerCase();
            const state = String(r.state_name || '').toLowerCase();
            return (
              pincode.includes(normalizedSearch) ||
              area.includes(normalizedSearch) ||
              city.includes(normalizedSearch) ||
              state.includes(normalizedSearch)
            );
          });

    filteredRecords.sort((a, b) => {
      const pinCompare = a.pincode.localeCompare(b.pincode);
      if (pinCompare !== 0) return pinCompare;
      return a.area_name.localeCompare(b.area_name);
    });

    const data = filteredRecords.map(
      (record) =>
        `${sanitizeCsvField(record.pincode)},${record.area_name},${record.city_name},${record.state_name}`
    );

    return {
      ok: true,
      status: 200,
      message: 'Pincode list fetched successfully.',
      data,
    };
  } catch (err) {
    console.error('listAllPincodes', err.message);
    return { ok: false, status: 500, message: 'Internal server error.' };
  }
};

module.exports = {
  sendOtp,
  verifyOtpAndLogin,
  updateUser,
  listAllPincodes,
};
