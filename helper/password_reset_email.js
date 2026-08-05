const { sendTemplateEmail, isSmtpConfigured } = require('./mail');
const { buildPasswordResetOtpEmail } = require('./email_templates/password_reset_otp_email');
const { EMAIL_OTP_DEV_FALLBACK, NODE_ENV } = require('../config/env');

const maskEmailForLog = (email) => {
  const [local, domain] = String(email).split('@');
  if (!domain) {
    return '***';
  }
  const visible = local.length <= 2 ? '*' : local.slice(0, 2);
  return `${visible}***@${domain}`;
};

/**
 * Deliver a password-reset OTP to the user's email via SMTP (or dev fallback).
 * @param {{ to: string, otp: string }} params
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
const sendPasswordResetOtpEmail = async ({ to, otp }) => {
  const { subject, text, html } = buildPasswordResetOtpEmail(otp);

  if (isSmtpConfigured()) {
    try {
      await sendTemplateEmail(to, subject, html, text);
      return { ok: true };
    } catch (error) {
      const message = error?.message || 'SMTP send failed.';
      console.error('[password-reset-email] SMTP send failed:', message);
      return { ok: false, message };
    }
  }

  if (EMAIL_OTP_DEV_FALLBACK && NODE_ENV !== 'production') {
    console.log(`[password-reset-email][dev-fallback] OTP for ${maskEmailForLog(to)}: ${otp}`);
    return { ok: true };
  }

  console.error(
    '[password-reset-email] SMTP is not configured. Set EMAIL_USER and EMAIL_PASS (or EMAIL_OTP_DEV_FALLBACK=true in non-production).'
  );
  return { ok: false, message: 'Email delivery is not configured.' };
};

module.exports = {
  sendPasswordResetOtpEmail,
};
