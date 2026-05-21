const { registerPartner, loginPartner } = require('../../../services/mobile/partner/partner_service');

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

module.exports = {
  register,
  login,
};
