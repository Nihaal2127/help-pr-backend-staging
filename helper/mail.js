const nodemailer = require('nodemailer');

const isSmtpConfigured = () =>
  Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

const createTransporter = () => {
  if (!isSmtpConfigured()) {
    throw new Error('SMTP is not configured (EMAIL_USER / EMAIL_PASS).');
  }

  const host = process.env.EMAIL_HOST;
  if (host) {
    return nodemailer.createTransport({
      host,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'Gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const sendEmail = async (to, subject, text) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    text,
  });
};

const sendTemplateEmail = async (to, subject, html, text, attachments = []) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    text: text || 'Please find your invoice attached.',
    html: html || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
  });
};

module.exports = { sendEmail, sendTemplateEmail, isSmtpConfigured };