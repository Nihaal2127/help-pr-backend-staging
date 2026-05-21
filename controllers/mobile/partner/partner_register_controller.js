const { registerPartner } = require('../../../services/mobile/partner/partner_register_service');

const register = async (req, res) => {
  try {
    const { name, email, phone_number, password, date_of_birth } = req.body;
    const { token, auth_token, record } = await registerPartner({
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
      token,
      auth_token,
      record,
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

module.exports = { register };
