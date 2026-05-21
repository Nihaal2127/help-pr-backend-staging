const nodemailer = require('nodemailer');

const createTransporter = () =>
  nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

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

module.exports = { sendEmail, sendTemplateEmail };