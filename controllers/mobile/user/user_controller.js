const {
  sendOtp,
  verifyOtpAndLogin,
  googleLogin,
  appleLogin,
  updateUser,
  listAllPincodes,
} = require('../../../services/mobile/user/user_service');
const {
  requestForgotPasswordOtp,
  verifyForgotPasswordOtp,
  resetPasswordWithToken,
} = require('../../../services/mobile/shared/forgot_password_service');
const { USER_TYPE_CUSTOMER } = require('../../../constants/user_types');
const {
  wrapMobileHandler,
  sendTopLevelServiceResult,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const sendOtpHandler = wrapMobileHandler(
  'mobile user send-otp',
  async (req, res) => {
    const result = await sendOtp({ phone_number: req.body.phone_number });
    return sendTopLevelServiceResult(res, result);
  },
  { errorMessage: 'Failed to send OTP.' }
);

const verifyOtpHandler = wrapMobileHandler(
  'mobile user verify-otp',
  async (req, res) => {
    const result = await verifyOtpAndLogin({
      phone_number: req.body.phone_number,
      device_token: req.body.device_token,
      validOtp: req.validOtp,
    });
    return sendTopLevelServiceResult(res, result);
  },
  { errorMessage: 'Failed to verify OTP.' }
);

const googleLoginHandler = wrapMobileHandler(
  'mobile user google-login',
  async (req, res) => {
    const result = await googleLogin({
      id_token: req.body.id_token,
      device_token: req.body.device_token,
    });
    return sendTopLevelServiceResult(res, result);
  },
  { errorMessage: 'Failed to sign in with Google.' }
);

const appleLoginHandler = wrapMobileHandler(
  'mobile user apple-login',
  async (req, res) => {
    const result = await appleLogin({
      id_token: req.body.id_token,
      device_token: req.body.device_token,
      name: req.body.name,
    });
    return sendTopLevelServiceResult(res, result);
  },
  { errorMessage: 'Failed to sign in with Apple.' }
);

const forgotPasswordHandler = wrapMobileHandler(
  'mobile user forgot-password',
  async (req, res) => {
    const result = await requestForgotPasswordOtp({
      email: req.body.email,
      userType: USER_TYPE_CUSTOMER,
    });
    return sendTopLevelServiceResult(res, result);
  },
  { errorMessage: 'Failed to send password reset OTP.' }
);

const verifyForgotPasswordOtpHandler = wrapMobileHandler(
  'mobile user verify-forgot-password-otp',
  async (req, res) => {
    const result = await verifyForgotPasswordOtp({
      email: req.body.email,
      otp: req.body.otp,
      userType: USER_TYPE_CUSTOMER,
    });

    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      verified: result.verified,
      reset_token: result.reset_token,
    });
  },
  { errorMessage: 'Failed to verify OTP.' }
);

const resetPasswordHandler = wrapMobileHandler(
  'mobile user reset-password',
  async (req, res) => {
    const result = await resetPasswordWithToken({
      resetToken: req.body.reset_token,
      newPassword: req.body.new_password,
      userType: USER_TYPE_CUSTOMER,
    });
    return sendTopLevelServiceResult(res, result);
  },
  { errorMessage: 'Failed to reset password.' }
);

const updateHandler = wrapMobileHandler('mobile user update', async (req, res) => {
  const result = await updateUser({
    customerId: req.user.id,
    body: req.body,
    files: req.files,
  });
  return sendTopLevelServiceResult(res, result);
});

const getPincodesHandler = wrapMobileHandler('mobile user pincodes', async (req, res) => {
  const result = await listAllPincodes({ search: req.query.search });
  return sendTopLevelServiceResult(res, result);
});

module.exports = {
  sendOtpHandler,
  verifyOtpHandler,
  googleLoginHandler,
  appleLoginHandler,
  forgotPasswordHandler,
  verifyForgotPasswordOtpHandler,
  resetPasswordHandler,
  updateHandler,
  getPincodesHandler,
};
