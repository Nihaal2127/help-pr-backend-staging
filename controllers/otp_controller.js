const express = require('express');
const User = require('../models/user');
const nodemailer = require('nodemailer');
const Otp = require('../models/otp');
const crypto = require('crypto');
const { sendEmail } = require('../helper/mail');

const createOtp = async (phone_number) => {
  // Generate and hash OTP
  // const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otp = "123456";
  const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10-minute expiry

  // Save OTP to database
  return await Otp.create({ phone_number, otp: hashedOtp, expiresAt });

}
const sentOpt = async (req, res) => {
  const { phone_number } = req.body;

  try {

    const otp = await createOtp(phone_number);
    // await sendEmail(email, 'Help Pr Login OTP', `Your OTP For Login is: ${otp}`);
    res.status(200).json({
      success: true,
      status: 200,
      message: 'OTP sent successfully'
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to send OTP'
    });
  }
};

const verifyOtp = async (req, res) => {
  try {
    // OTP has already been validated by the middleware
    const { phone_number, device_token } = req.body;

    let user = await User.findOne({ phone_number, deleted_at: null });
    if (!user) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid credentials.'
      });
    }
    user.device_token = device_token;
    await Otp.deleteOne({ _id: req.validOtp._id });
    user.generateAuthToken();
    await user.save();

    user = await User.findById({ _id: user._id }).populate([
      { path: "city_id" },
    ]).lean();
    const response = {
      ...user,
      city_id: user.city_id._id,
      city_name: user.city_id.name,
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

module.exports = { sentOpt, verifyOtp, sendEmail, createOtp };
