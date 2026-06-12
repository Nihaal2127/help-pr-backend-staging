const {
  sendOtp,
  verifyOtpAndLogin,
  updateUser,
  listAllPincodes,
} = require('../../../services/mobile/user/user_service');
const {
  wrapMobileHandler,
  sendTopLevelServiceResult,
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
  updateHandler,
  getPincodesHandler,
};
