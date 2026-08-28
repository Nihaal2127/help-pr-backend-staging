const mongoose = require('mongoose');
const User = require('../../../models/user');
const Area = require('../../../models/area');
const City = require('../../../models/city');
const Otp = require('../../../models/otp');
const notificationSetting = require('../../../models/notification_settings');
const { getNewId } = require('../../../helper/id_generator');
const { handleImageUpload } = require('../../../helper/image_uploader');
const { getUploadType } = require('../../../enum/upload_type_enum');
const { normalizeUserPhone, normalizeUserEmail, checkUserContactUniqueness, getPhoneLookupVariants } = require('../../../utils/user_contact_uniqueness');
const { escapeRegExp } = require('../../../utils/string_helpers');
const {
  registerDeviceToken,
  unregisterDeviceToken,
  buildDeviceRegistrationOptions,
} = require('../../../services/device_token_service');
const { deleteOwnAccount } = require('../shared/delete_own_account_service');
const { verifyGoogleIdToken, GOOGLE_APP_USER } = require('../../../helper/google_auth');
const { verifyAppleIdToken, APPLE_APP_USER } = require('../../../helper/apple_auth');
const { USER_TYPE_CUSTOMER } = require('../../../constants/user_types');
const {
  REGISTRATION_TYPE_OTP,
  REGISTRATION_TYPE_GOOGLE,
  REGISTRATION_TYPE_APPLE,
} = require('../../../constants/registration_types');
const { fail, okWithMessage } = require('../../../utils/mobile_service_result');
const { issueAndSendPhoneOtp } = require('../shared/phone_otp_delivery_service');
const { failIfDeletedAccount } = require('../shared/deleted_account_guard');

const findCustomerByPhone = async (phone_number) => {
  const normalizedPhone = normalizeUserPhone(phone_number);
  const phoneVariants = getPhoneLookupVariants(normalizedPhone);
  if (phoneVariants.length === 0) return null;

  return User.findOne({
    phone_number: { $in: phoneVariants },
    type: USER_TYPE_CUSTOMER,
    deleted_at: null,
  });
};

const findOrCreateCustomer = async (phone_number) => {
  const normalizedPhone = normalizeUserPhone(phone_number);
  let user = await findCustomerByPhone(phone_number);

  if (user) {
    if (user.phone_number !== normalizedPhone) {
      user.phone_number = normalizedPhone;
      await user.save();
    }
    return { ok: true, user };
  }

  const deletedAccount = await failIfDeletedAccount({
    phone_number: normalizedPhone,
    type: USER_TYPE_CUSTOMER,
  });
  if (deletedAccount) {
    return deletedAccount;
  }

  const uniqueness = await checkUserContactUniqueness({
    phone_number: normalizedPhone,
    type: USER_TYPE_CUSTOMER,
  });
  if (!uniqueness.ok) {
    return fail(409, uniqueness.message);
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
    registration_type: REGISTRATION_TYPE_OTP,
    is_from_web: false,
    is_active: true,
  });

  try {
    await user.save();
  } catch (err) {
    if (err?.code === 11000) {
      return fail(409, 'Phone number already exists.');
    }
    throw err;
  }

  await notificationSetting.create({ user_id: user._id });

  return { ok: true, user };
};

const sendOtp = async ({ phone_number }) => {
  const customerResult = await findOrCreateCustomer(phone_number);
  if (!customerResult.ok) {
    return customerResult;
  }

  return issueAndSendPhoneOtp({ phone_number });
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

const finalizeCustomerLogin = async (user, device_token, message, deviceOptions = {}) => {
  if (user.is_blocked === true) {
    return fail(403, 'Your account is blocked. Please contact support.');
  }

  if (device_token !== undefined && device_token !== null && String(device_token).trim() !== '') {
    user.device_token = String(device_token).trim();
  }

  user.generateAuthToken();
  await user.save();

  if (device_token !== undefined && device_token !== null && String(device_token).trim() !== '') {
    await registerDeviceToken({
      userId: user._id,
      ...buildDeviceRegistrationOptions({
        device_token,
        platform: deviceOptions.platform,
        device_id: deviceOptions.device_id,
      }),
    });
  }

  const data = await buildCustomerLoginData(user);
  if (!data) {
    return fail(500, 'Failed to load user profile.');
  }

  return okWithMessage(200, message, { data });
};

const logoutCustomer = async ({ userId, device_token, device_id }) => {
  const user = await User.findOne({
    _id: userId,
    type: USER_TYPE_CUSTOMER,
    deleted_at: null,
  });

  if (!user) {
    return fail(404, 'Customer not found.');
  }

  if (device_token || device_id) {
    await unregisterDeviceToken({
      userId,
      deviceToken: device_token,
      deviceId: device_id,
    });
  }

  user.auth_token = null;
  await user.save();

  return okWithMessage(200, 'Logged out successfully.');
};

const deleteOwnCustomerAccount = async ({ userId }) =>
  deleteOwnAccount({
    userId,
    expectedType: USER_TYPE_CUSTOMER,
    notFoundMessage: 'Customer not found.',
  });

const applyGoogleProfileToUser = (user, { email, name, picture }) => {
  if (email && !user.email) {
    user.email = normalizeUserEmail(email);
  }
  if (name && !user.name) {
    user.name = name;
  }
  if (picture && !user.profile_url) {
    user.profile_url = picture;
  }
};

const applyAppleProfileToUser = (user, { email, name }) => {
  if (email && !user.email) {
    user.email = normalizeUserEmail(email);
  }
  if (name && !user.name) {
    user.name = name;
  }
};

const verifyOtpAndLogin = async ({
  phone_number,
  device_token,
  validOtp,
  platform,
  device_id,
}) => {
  const normalizedPhone = normalizeUserPhone(phone_number);
  const phoneVariants = getPhoneLookupVariants(normalizedPhone);
  const user = await User.findOne({
    phone_number: { $in: phoneVariants },
    type: USER_TYPE_CUSTOMER,
    deleted_at: null,
  });

  if (!user) {
    const deletedAccount = await failIfDeletedAccount({
      phone_number: normalizedPhone,
      type: USER_TYPE_CUSTOMER,
    });
    if (deletedAccount) {
      return deletedAccount;
    }
    return fail(401, 'Invalid credentials.');
  }

  await Otp.deleteOne({ _id: validOtp._id });

  return finalizeCustomerLogin(user, device_token, 'OTP verified successfully.', {
    platform,
    device_id,
  });
};

const googleLogin = async ({ id_token, device_token, platform, device_id }) => {
  let googleProfile;
  try {
    googleProfile = await verifyGoogleIdToken(id_token, { app: GOOGLE_APP_USER });
  } catch (err) {
    console.error('googleLogin token verification', err.message);
    if (String(err.message || '').includes('not configured')) {
      return fail(500, 'Google sign-in is not configured on the server.');
    }
    return fail(401, 'Invalid or expired Google token.');
  }

  const { google_id, email, name, picture } = googleProfile;

  let user = await User.findOne({ google_id, deleted_at: null });

  if (user) {
    if (Number(user.type) !== USER_TYPE_CUSTOMER) {
      return fail(409, 'This Google account is registered with another account type.');
    }
    applyGoogleProfileToUser(user, { email, name, picture });
    return finalizeCustomerLogin(user, device_token, 'Logged in successfully.', {
      platform,
      device_id,
    });
  }

  const deletedByGoogle = await failIfDeletedAccount({ google_id });
  if (deletedByGoogle) {
    return deletedByGoogle;
  }

  if (email) {
    const normalizedEmail = normalizeUserEmail(email);
    user = await User.findOne({
      email: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, 'i'),
      deleted_at: null,
    });

    if (user) {
      if (Number(user.type) !== USER_TYPE_CUSTOMER) {
        return fail(409, 'This email is registered with another account type.');
      }
      if (user.google_id && user.google_id !== google_id) {
        return fail(409, 'This email is linked to a different Google account.');
      }

      user.google_id = google_id;
      applyGoogleProfileToUser(user, { email, name, picture });
      return finalizeCustomerLogin(user, device_token, 'Logged in successfully.', {
      platform,
      device_id,
    });
    }

    const deletedByEmail = await failIfDeletedAccount({ email: normalizedEmail });
    if (deletedByEmail) {
      return deletedByEmail;
    }
  }

  const uniqueness = await checkUserContactUniqueness({ email });
  if (!uniqueness.ok) {
    return fail(409, uniqueness.message);
  }

  const registration_id = await getNewId(0);
  const user_id = await getNewId(USER_TYPE_CUSTOMER);
  const _id = new mongoose.Types.ObjectId();

  user = new User({
    _id,
    registration_id,
    user_id,
    google_id,
    email: email ? normalizeUserEmail(email) : null,
    name: name || null,
    profile_url: picture || null,
    type: USER_TYPE_CUSTOMER,
    registration_type: REGISTRATION_TYPE_GOOGLE,
    is_from_web: false,
    is_active: true,
  });

  await user.save();
  await notificationSetting.create({ user_id: user._id });

  return finalizeCustomerLogin(user, device_token, 'Logged in successfully.', {
    platform,
    device_id,
  });
};

const appleLogin = async ({ id_token, device_token, name, platform, device_id }) => {
  let appleProfile;
  try {
    appleProfile = await verifyAppleIdToken(id_token, { app: APPLE_APP_USER });
  } catch (err) {
    console.error('appleLogin token verification', err.message);
    if (String(err.message || '').includes('not configured')) {
      return fail(500, 'Apple sign-in is not configured on the server.');
    }
    return fail(401, 'Invalid or expired Apple token.');
  }

  const { apple_id, email } = appleProfile;
  const displayName =
    name !== undefined && name !== null && String(name).trim() !== '' ? String(name).trim() : null;

  let user = await User.findOne({ apple_id, deleted_at: null });

  if (user) {
    if (Number(user.type) !== USER_TYPE_CUSTOMER) {
      return fail(409, 'This Apple account is registered with another account type.');
    }
    applyAppleProfileToUser(user, { email, name: displayName });
    return finalizeCustomerLogin(user, device_token, 'Logged in successfully.', {
      platform,
      device_id,
    });
  }

  const deletedByApple = await failIfDeletedAccount({ apple_id });
  if (deletedByApple) {
    return deletedByApple;
  }

  if (email) {
    const normalizedEmail = normalizeUserEmail(email);
    user = await User.findOne({
      email: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, 'i'),
      deleted_at: null,
    });

    if (user) {
      if (Number(user.type) !== USER_TYPE_CUSTOMER) {
        return fail(409, 'This email is registered with another account type.');
      }
      if (user.apple_id && user.apple_id !== apple_id) {
        return fail(409, 'This email is linked to a different Apple account.');
      }

      user.apple_id = apple_id;
      applyAppleProfileToUser(user, { email, name: displayName });
      return finalizeCustomerLogin(user, device_token, 'Logged in successfully.', {
      platform,
      device_id,
    });
    }

    const deletedByEmail = await failIfDeletedAccount({ email: normalizedEmail });
    if (deletedByEmail) {
      return deletedByEmail;
    }
  }

  const uniqueness = await checkUserContactUniqueness({ email });
  if (!uniqueness.ok) {
    return fail(409, uniqueness.message);
  }

  const registration_id = await getNewId(0);
  const user_id = await getNewId(USER_TYPE_CUSTOMER);
  const _id = new mongoose.Types.ObjectId();

  user = new User({
    _id,
    registration_id,
    user_id,
    apple_id,
    email: email ? normalizeUserEmail(email) : null,
    name: displayName || null,
    type: USER_TYPE_CUSTOMER,
    registration_type: REGISTRATION_TYPE_APPLE,
    is_from_web: false,
    is_active: true,
  });

  await user.save();
  await notificationSetting.create({ user_id: user._id });

  return finalizeCustomerLogin(user, device_token, 'Logged in successfully.', {
    platform,
    device_id,
  });
};

const MOBILE_USER_ALLOWED_UPDATE_FIELDS = ['name', 'phone_number', 'email', 'date_of_birth', 'gender'];

const updateUser = async ({ customerId, body, files }) => {
  const user = await User.findOne({
    _id: customerId,
    type: USER_TYPE_CUSTOMER,
    deleted_at: null,
  });

  if (!user) {
    return fail(404, 'Customer not found.');
  }

  if (user.is_blocked === true) {
    return fail(403, 'Your account is blocked. Please contact support.');
  }

  if (files?.profile_photo?.[0]) {
    user.profile_url = await handleImageUpload(
      files.profile_photo[0],
      getUploadType(4),
      true,
      user.profile_url
    );
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
    return fail(500, 'Failed to load user profile.');
  }

  return okWithMessage(200, 'User updated successfully.', { data });
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

    return okWithMessage(200, 'Pincode list fetched successfully.', { data });
  } catch (err) {
    console.error('listAllPincodes', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  sendOtp,
  verifyOtpAndLogin,
  googleLogin,
  appleLogin,
  logoutCustomer,
  deleteOwnCustomerAccount,
  updateUser,
  listAllPincodes,
};
