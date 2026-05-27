const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../../../models/user');
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

module.exports = {
  sendOtp,
  verifyOtpAndLogin,
};
