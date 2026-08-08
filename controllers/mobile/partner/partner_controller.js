const {
  registerPartner,
  loginPartner,
  sendPartnerOtp,
  verifyPartnerOtpAndLogin,
  googleLoginPartner,
  appleLoginPartner,
  logoutPartner,
  updatePartner,
} = require('../../../services/mobile/partner/partner_service');
const {
  requestForgotPasswordOtp,
  verifyForgotPasswordOtp: verifyForgotPasswordOtpService,
  resetPasswordWithToken,
} = require('../../../services/mobile/shared/forgot_password_service');
const { USER_TYPE_PARTNER } = require('../../../constants/user_types');
const {
  wrapMobileHandler,
  sendServiceError,
  sendTopLevelServiceResult,
} = require('../../../utils/mobile_controller_helpers');

const logPartnerRegisterError = (step, error) => {
  console.error('[partner.register] FAILED at step:', step);
  console.error('[partner.register] error.message:', error?.message);
  console.error('[partner.register] error.name:', error?.name);
  if (error?.code !== undefined) {
    console.error('[partner.register] error.code:', error.code);
  }
  if (error?.stack) {
    console.error('[partner.register] error.stack:', error.stack);
  }
};

const register = async (req, res) => {
  const maskedEmail = String(req.body?.email || '').replace(/(.{2}).*(@.*)/, '$1***$2');
  console.log('[partner.register] request received', {
    email: maskedEmail,
    phone_number: req.body?.phone_number ? '***' + String(req.body.phone_number).slice(-4) : null,
    has_password: Boolean(req.body?.password),
    date_of_birth: req.body?.date_of_birth,
  });

  try {
    const { name, email, phone_number, password, date_of_birth } = req.body;
    const { data } = await registerPartner({
      name,
      email,
      phone_number,
      password,
      date_of_birth,
    });

    console.log('[partner.register] success', { user_id: data?.user_id, _id: data?._id });

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Partner registered successfully.',
      data,
    });
  } catch (error) {
    logPartnerRegisterError('controller', error);
    const status = Number(error.status) || 500;
    const payload = {
      success: false,
      status,
      message: status === 409 ? error.message : 'Internal server error.',
    };
    if (status === 500) {
      payload.debug = {
        step: error.registerStep || 'unknown',
        error: error.message,
        name: error.name,
        ...(error.code !== undefined ? { code: error.code } : {}),
      };
    }
    return res.status(status).json(payload);
  }
};

const login = wrapMobileHandler('mobile partner login', async (req, res) => {
  const result = await loginPartner({
    email: req.body.email,
    password: req.body.password,
    device_token: req.body.device_token,
    platform: req.body.platform,
    device_id: req.body.device_id,
  });

  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(200).json({
    success: true,
    status: 200,
    message: 'Login successfully.',
    data: result.data,
  });
});

const sendPartnerOtpHandler = wrapMobileHandler(
  'mobile partner send-otp',
  async (req, res) => {
    const result = await sendPartnerOtp({ phone_number: req.body.phone_number });
    return sendTopLevelServiceResult(res, result);
  },
  { errorMessage: 'Failed to send OTP.' }
);

const verifyPartnerOtpHandler = wrapMobileHandler(
  'mobile partner verify-otp',
  async (req, res) => {
    const result = await verifyPartnerOtpAndLogin({
      phone_number: req.body.phone_number,
      device_token: req.body.device_token,
      platform: req.body.platform,
      device_id: req.body.device_id,
      validOtp: req.validOtp,
    });
    return sendTopLevelServiceResult(res, result);
  },
  { errorMessage: 'Failed to verify OTP.' }
);

const googleLogin = wrapMobileHandler('mobile partner google-login', async (req, res) => {
  const result = await googleLoginPartner({
    id_token: req.body.id_token,
    device_token: req.body.device_token,
    phone_number: req.body.phone_number,
    date_of_birth: req.body.date_of_birth,
    platform: req.body.platform,
    device_id: req.body.device_id,
  });

  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(200).json({
    success: true,
    status: 200,
    message: result.message || 'Login successfully.',
    data: result.data,
  });
});

const appleLogin = wrapMobileHandler('mobile partner apple-login', async (req, res) => {
  const result = await appleLoginPartner({
    id_token: req.body.id_token,
    device_token: req.body.device_token,
    phone_number: req.body.phone_number,
    date_of_birth: req.body.date_of_birth,
    name: req.body.name,
    platform: req.body.platform,
    device_id: req.body.device_id,
  });

  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(200).json({
    success: true,
    status: 200,
    message: result.message || 'Login successfully.',
    data: result.data,
  });
});

const forgotPassword = wrapMobileHandler(
  'mobile partner forgot-password',
  async (req, res) => {
    const result = await requestForgotPasswordOtp({
      email: req.body.email,
      userType: USER_TYPE_PARTNER,
    });

    if (!result.ok) {
      return sendServiceError(res, result);
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.message,
    });
  },
  { errorMessage: 'Failed to send password reset OTP.' }
);

const verifyForgotPasswordOtp = wrapMobileHandler(
  'mobile partner verify-forgot-password-otp',
  async (req, res) => {
    const result = await verifyForgotPasswordOtpService({
      email: req.body.email,
      otp: req.body.otp,
      userType: USER_TYPE_PARTNER,
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

const resetPassword = wrapMobileHandler('mobile partner reset-password', async (req, res) => {
  const result = await resetPasswordWithToken({
    resetToken: req.body.reset_token,
    newPassword: req.body.new_password,
    userType: USER_TYPE_PARTNER,
  });

  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(200).json({
    success: true,
    status: 200,
    message: result.message,
  });
});

const update = async (req, res) => {
  try {
    const result = await updatePartner({
      partnerId: req.user.id,
      body: req.body,
      files: req.files,
      section: 'all',
    });

    if (!result.ok) {
      return sendServiceError(res, result);
    }

    const message = result.passwordUpdated
      ? 'Password updated successfully.'
      : 'Partner updated successfully.';

    return res.status(200).json({
      success: true,
      status: 200,
      message,
      password_updated: result.passwordUpdated === true,
      data: result.data,
    });
  } catch (error) {
    console.error('mobile partner update', error.message);
    const status = Number(error.status) || 500;
    return res.status(status).json({
      success: false,
      status,
      message: status === 500 ? 'Internal server error.' : String(error.message),
    });
  }
};

const logout = wrapMobileHandler('mobile partner logout', async (req, res) => {
  const result = await logoutPartner({
    userId: req.user.id,
    device_token: req.body.device_token,
    device_id: req.body.device_id,
  });

  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(200).json({
    success: true,
    status: 200,
    message: result.message || 'Logged out successfully.',
  });
});

module.exports = {
  register,
  login,
  sendPartnerOtpHandler,
  verifyPartnerOtpHandler,
  googleLogin,
  appleLogin,
  forgotPassword,
  verifyForgotPasswordOtp,
  resetPassword,
  update,
  logout,
};
