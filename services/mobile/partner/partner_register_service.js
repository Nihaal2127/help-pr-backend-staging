const mongoose = require('mongoose');
const User = require('../../../models/user');
const notificationSetting = require('../../../models/notification_settings');
const { getNewId } = require('../../../helper/id_generator');

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

  const record = savedUser.toObject();
  delete record.password;

  return {
    token,
    auth_token: token,
    record,
  };
};

module.exports = { registerPartner };
