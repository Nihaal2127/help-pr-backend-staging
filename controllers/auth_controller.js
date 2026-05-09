const User = require('../models/user');
const { generateRandomPassword } = require('../helper/password_generator');
const { sendEmail } = require('../helper/mail');


const login = async (req, res) => {
  try {
    
    const { email, password, device_token } = req.body;
    console.log(device_token);
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Email and password are required.'
      });
    }
    let user = await User.findOne({ email, deleted_at: null }).select('+password'); // Include password explicitly
    if (!user) {
      return res.status(400).json({
        success: false,
        status: 401,
        message: 'Invalid credentials.'
      });
    }
    if (user.is_active === false) {
      return res.status(400).json({
        success: false,
        status: 401,
        message: 'You are not approve please contact your admin.'
      });
    }
    const isPasswordMatch = await user.comparePassword(password);
    
    if (!isPasswordMatch) {
      return res.status(400).json({
        success: false,
        status: 401,
        message: 'Invalid credentials.'
      });
    }
    
    user.auth_token = user.generateAuthToken();
    user.device_token = device_token;
    await user.save();
    console.log('user.device_token',user.device_token);
    // await createOtp(email);
    if (user.type === 1) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'User fetched successfully',
        record: user,
      });
    }
    user = await User.findById({ _id: user._id }).populate([
      { path: "city_id" },
    ]).lean();
    const response = {
      ...user,
      city_id: user?.city_id?._id || null,
      city_name: user?.city_id?.name || null,
    };

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Login successfully.',
      record: response,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: err.message,
    });
  }
};


const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Please enter your registered email.'
      });
    }
    const user = await User.findOne({ email, deleted_at: null });

    if (!user) {
      return res.status(400).json({
        success: false,
        status: 401,
        message: 'Invalid credentials.'
      });
    }

    const password = generateRandomPassword(8);
    user.password = password;
    await user.save()
    // await sendEmail(email, 'Helper Forgot Password', `Your Password For Login is: ${password}`);
    await sendEmail('idekavadiya96@gmail.com', 'Helper Forgot Password', `Your Password For Login is: ${password}`);
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'New password sent successfully on your registered mail.',
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: err.message,
    });
  }
};
const logout = async (req, res) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Authorization token is missing.',
    });
  }
  try {

    const admin = await User.findOne({ _id: req.user.id, deleted_at: null });
    if (!admin) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'User not found or deleted.',
      });
    }
    admin.auth_token = null;
    admin.device_token = null;
    await admin.save();
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'User logged out successfully.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};
const userLogin = async (req, res) => {
  try {
    
    const { phone_number, device_token } = req.body;

    let user = await User.findOne({ phone_number, deleted_at: null });
    
    if (!user) {
      return res.status(201).json({
        success: true,
        status: 201,
        message: 'New user created.'
      });
    }
    user.device_token = device_token;
    user.generateAuthToken();
    await user.save();

    user = await User.findById({ _id: user._id }).populate([
      { path: "city_id" },
    ]).lean();
    const response = {
      ...user,
      city_id: user?.city_id?._id || null,
      city_name: user?.city_id?.name || null,
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
      message: 'Failed to verify OTP'
    });
  }
};
module.exports = { login, logout, forgotPassword,userLogin };
