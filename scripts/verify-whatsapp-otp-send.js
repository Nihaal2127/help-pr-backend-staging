#!/usr/bin/env node
/**
 * Smoke-test Meta WhatsApp OTP delivery.
 *
 * Usage:
 *   WHATSAPP_ENABLED=true \
 *   WHATSAPP_PHONE_NUMBER_ID=... \
 *   WHATSAPP_ACCESS_TOKEN=... \
 *   WHATSAPP_OTP_TEMPLATE_NAME=... \
 *   node scripts/verify-whatsapp-otp-send.js 9876543210
 */
require('dotenv').config();

const { sendVerificationOtp } = require('../helper/whatsapp');
const { generateOtp } = require('../helper/phone_otp');

const phone = process.argv[2];

const main = async () => {
  if (!phone) {
    console.error('Usage: node scripts/verify-whatsapp-otp-send.js <phone_number>');
    process.exit(1);
  }

  const otp = generateOtp();
  const result = await sendVerificationOtp({ phone_number: phone, otp });

  if (!result.ok) {
    console.error('WhatsApp OTP send failed:', result.message);
    process.exit(1);
  }

  console.log('WhatsApp OTP sent successfully.');
  console.log('message_id:', result.messageId || '(none)');
  if (process.env.WHATSAPP_OTP_DEV_FALLBACK === 'true') {
    console.log('dev OTP:', otp);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
