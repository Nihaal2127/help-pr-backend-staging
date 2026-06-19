const OTP_EXPIRY_MINUTES = 5;

const buildPasswordResetOtpEmail = (otp) => {
  const subject = 'Password Reset OTP';
  const text = [
    'You requested a password reset for your Helper account.',
    '',
    `Your one-time password (OTP) is: ${otp}`,
    '',
    `This OTP expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    '',
    'Do not share this OTP with anyone. Helper staff will never ask for your OTP.',
    '',
    'If you did not request a password reset, you can safely ignore this email.',
  ].join('\n');

  const html = `
    <p>You requested a password reset for your Helper account.</p>
    <p><strong>Your one-time password (OTP) is: ${otp}</strong></p>
    <p>This OTP expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
    <p><strong>Do not share this OTP with anyone.</strong> Helper staff will never ask for your OTP.</p>
    <p>If you did not request a password reset, you can safely ignore this email.</p>
  `.trim();

  return { subject, text, html };
};

module.exports = {
  OTP_EXPIRY_MINUTES,
  buildPasswordResetOtpEmail,
};
