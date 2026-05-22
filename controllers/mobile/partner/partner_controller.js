const {
  registerPartner,
  loginPartner,
  updatePartner,
} = require('../../../services/mobile/partner/partner_service');

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
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password, device_token } = req.body;
    const result = await loginPartner({ email, password, device_token });

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    const { data } = result;

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Login successfully.',
      data,
    });
  } catch (error) {
    console.error('mobile partner login', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const update = async (req, res) => {
  try {
    const result = await updatePartner({
      partnerId: req.user.id,
      body: req.body,
      files: req.files,
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
