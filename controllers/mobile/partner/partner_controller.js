const {
  registerPartner,
  loginPartner,
  updatePartner,
} = require('../../../services/mobile/partner/partner_service');
const {
  wrapMobileHandler,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const register = async (req, res) => {
  try {
    const { name, email, phone_number, password, date_of_birth } = req.body;
    const { data } = await registerPartner({
      name,
      email,
      phone_number,
      password,
      date_of_birth,
    });

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Partner registered successfully.',
      data,
    });
  } catch (error) {
    console.error('mobile partner register', error.message);
    const status = Number(error.status) || 500;
    return res.status(status).json({
      success: false,
      status,
      message: status === 409 ? error.message : 'Internal server error.',
    });
  }
};

const login = wrapMobileHandler('mobile partner login', async (req, res) => {
  const result = await loginPartner({
    email: req.body.email,
    password: req.body.password,
    device_token: req.body.device_token,
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

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Partner updated successfully.',
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

module.exports = {
  register,
  login,
  update,
};
