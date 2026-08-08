const User = require('../models/user');
const Otp = require('../models/otp');
const { issueAndSendPhoneOtp } = require('../services/mobile/shared/phone_otp_delivery_service');
const { normalizeUserPhone, getPhoneLookupVariants } = require('../utils/user_contact_uniqueness');
const {
  registerDeviceToken,
  unregisterDeviceToken,
  buildDeviceRegistrationOptions,
} = require('../services/device_token_service');

const createOtp = async (phone_number) => issueAndSendPhoneOtp({ phone_number });

const sentOpt = async (req, res) => {
  const { phone_number } = req.body;

  try {
    const result = await issueAndSendPhoneOtp({ phone_number });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.message,
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to send OTP',
    });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { phone_number, device_token, platform, device_id } = req.body;
    const normalizedPhone = normalizeUserPhone(phone_number);
    const phoneVariants = getPhoneLookupVariants(normalizedPhone);

    let user = await User.findOne({
      phone_number: { $in: phoneVariants },
      deleted_at: null,
    });
    if (!user) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid credentials.',
      });
    }

    if (device_token !== undefined && device_token !== null && String(device_token).trim() !== '') {
      user.device_token = String(device_token).trim();
    }

    await Otp.deleteOne({ _id: req.validOtp._id });
    user.generateAuthToken();
    await user.save();

    if (device_token !== undefined && device_token !== null && String(device_token).trim() !== '') {
      await registerDeviceToken({
        userId: user._id,
        ...buildDeviceRegistrationOptions({ device_token, platform, device_id }),
      });
    }

    user = await User.findById({ _id: user._id }).populate([{ path: 'city_id' }]).lean();

    const response = {
      ...user,
      city_id: user.city_id?._id ?? user.city_id ?? null,
      city_name: user.city_id?.name ?? null,
    };

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'OTP verified successfully.',
      record: response,
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to verify OTP',
    });
  }
};

module.exports = { sentOpt, verifyOtp, createOtp };
