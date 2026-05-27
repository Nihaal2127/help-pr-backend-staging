const {
  sendOtp,
  verifyOtpAndLogin,
  updateUser,
  listAllPincodes,
} = require('../../../services/mobile/user/user_service');

const sendOtpHandler = async (req, res) => {
  try {
    const { phone_number } = req.body;
    const result = await sendOtp({ phone_number });

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
    console.error('mobile user send-otp', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to send OTP.',
    });
  }
};

const verifyOtpHandler = async (req, res) => {
  try {
    const { phone_number, device_token } = req.body;
    const result = await verifyOtpAndLogin({
      phone_number,
      device_token,
      validOtp: req.validOtp,
    });

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
      data: result.data,
    });
  } catch (error) {
    console.error('mobile user verify-otp', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to verify OTP.',
    });
  }
};

const updateHandler = async (req, res) => {
  try {
    const result = await updateUser({
      customerId: req.user.id,
      body: req.body,
    });

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
      data: result.data,
    });
  } catch (error) {
    console.error('mobile user update', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getPincodesHandler = async (req, res) => {
  try {
    const search = req.query.search ?? req.query.q;
    const result = await listAllPincodes({ search });

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
      data: result.data,
    });
  } catch (error) {
    console.error('mobile user pincodes', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  sendOtpHandler,
  verifyOtpHandler,
  updateHandler,
  getPincodesHandler,
};
