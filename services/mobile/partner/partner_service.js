const mongoose = require('mongoose');
const User = require('../../../models/user');
const notificationSetting = require('../../../models/notification_settings');
const SubscriptionPlan = require('../../../models/subscription_plan');
const PartnerSubscription = require('../../../models/partner_subscription');
const { getNewId } = require('../../../helper/id_generator');

const DEFAULT_PARTNER_PLAN_NAME = 'basic';

const USER_TYPE_PARTNER = 2;
const REGISTRATION_TYPE_NORMAL = 1;

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

  const basicPlan = await SubscriptionPlan.findOne({
    plan_name: DEFAULT_PARTNER_PLAN_NAME,
    is_active: true,
    deleted_at: null,
  });
  if (!basicPlan) {
    throw new Error('Default subscription plan "basic" is not configured.');
  }

  await PartnerSubscription.create({
    partner_id: savedUser._id,
    subscription_plan_id: basicPlan._id,
    started_at: savedUser.created_at,
    expires_at: null,
    status: 'active',
    notes: 'Auto-assigned on mobile registration',
  });

  const data = savedUser.toObject();
  delete data.password;

  return {
    data,
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
  const data = {
    ...populated,
    city_id: populated?.city_id?._id || null,
    city_name: populated?.city_id?.name || null,
  };
  delete data.password;

  return {
    ok: true,
    data,
  };
};

module.exports = {
  registerPartner,
  loginPartner,
};
