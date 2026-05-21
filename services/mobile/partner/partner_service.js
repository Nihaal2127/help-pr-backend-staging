const mongoose = require('mongoose');
const User = require('../../../models/user');
const notificationSetting = require('../../../models/notification_settings');
const { getNewId } = require('../../../helper/id_generator');

const USER_TYPE_PARTNER = 2;
const REGISTRATION_TYPE_NORMAL = 1;

const buildPartnerLoginFlags = (user) => {
  const verificationStatus = Number(user.verification_status);
  const isActive = user.is_active === true;
  const isVerified = verificationStatus === 2;

  return {
    can_access_app: true,
    can_accept_jobs: isActive && isVerified && user.is_blocked !== true,
    partner_account_status:
      verificationStatus === 3
        ? 'rejected'
        : isActive && isVerified
          ? 'active'
          : 'pending',
  };
};

const registerPartner = async ({ name, email, phone_number, password, date_of_birth }) => {
  const registration_id = await getNewId(0);
  const user_id = await getNewId(USER_TYPE_PARTNER);
  const _id = new mongoose.Types.ObjectId();

  const newUser = new User({
    _id,
    registration_id,
    user_id,
    name,
    email,
    phone_number,
    date_of_birth,
    type: USER_TYPE_PARTNER,
    registration_type: REGISTRATION_TYPE_NORMAL,
    is_from_web: false,
    verification_status: 1,
    verified_at: null,
  });

  newUser.password = password;
  const token = newUser.generateAuthToken();
  const savedUser = await newUser.save();

  await notificationSetting.create({ user_id: savedUser._id });

  const record = savedUser.toObject();
  delete record.password;

  return {
    token,
    auth_token: token,
    record,
  };
};

const loginPartner = async ({ email, password, device_token }) => {
  const user = await User.findOne({ email, deleted_at: null }).select('+password');
  if (!user) {
    return { ok: false, status: 401, message: 'Invalid credentials.' };
  }

  if (Number(user.type) !== USER_TYPE_PARTNER) {
    return {
      ok: false,
      status: 403,
      message: 'This account is not a partner. Use the correct app to sign in.',
    };
  }

  if (user.is_blocked === true) {
    return {
      ok: false,
      status: 403,
      message: 'Your account is blocked. Please contact support.',
    };
  }

  if (Number(user.verification_status) === 3) {
    return {
      ok: false,
      status: 403,
      message: user.rejected_reasone?.trim()
        ? `Registration rejected: ${user.rejected_reasone.trim()}`
        : 'Your partner registration was rejected. Please contact admin.',
    };
  }

  const isPasswordMatch = await user.comparePassword(password);
  if (!isPasswordMatch) {
    return { ok: false, status: 401, message: 'Invalid credentials.' };
  }

  const token = user.generateAuthToken();
  if (device_token !== undefined && device_token !== null && String(device_token).trim() !== '') {
    user.device_token = String(device_token).trim();
  }
  await user.save();

  const populated = await User.findById(user._id).populate([{ path: 'city_id' }]).lean();
  const record = {
    ...populated,
    city_id: populated?.city_id?._id || null,
    city_name: populated?.city_id?.name || null,
  };
  delete record.password;

  const flags = buildPartnerLoginFlags(user);

  return {
    ok: true,
    token,
    auth_token: token,
    record,
    ...flags,
  };
};

module.exports = {
  registerPartner,
  loginPartner,
};
