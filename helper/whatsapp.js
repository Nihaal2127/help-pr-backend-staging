const axios = require('axios');
const {
  WHATSAPP_ENABLED,
  WHATSAPP_OTP_DEV_FALLBACK,
  WHATSAPP_API_VERSION,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_OTP_TEMPLATE_NAME,
  WHATSAPP_OTP_TEMPLATE_LANGUAGE,
  WHATSAPP_OTP_INCLUDE_COPY_BUTTON,
  NODE_ENV,
} = require('../config/env');
const { toWhatsAppRecipient, maskPhoneForLog } = require('./phone_otp');

const GRAPH_API_BASE = 'https://graph.facebook.com';

const assertWhatsAppConfigured = () => {
  if (!WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID is not configured.');
  }
  if (!WHATSAPP_ACCESS_TOKEN) {
    throw new Error('WHATSAPP_ACCESS_TOKEN is not configured.');
  }
  if (!WHATSAPP_OTP_TEMPLATE_NAME) {
    throw new Error('WHATSAPP_OTP_TEMPLATE_NAME is not configured.');
  }
};

const buildAuthenticationTemplateComponents = (otp) => {
  const components = [
    {
      type: 'body',
      parameters: [{ type: 'text', text: otp }],
    },
  ];

  if (WHATSAPP_OTP_INCLUDE_COPY_BUTTON) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: otp }],
    });
  }

  return components;
};

const mapWhatsAppError = (error) => {
  const apiMessage = error?.response?.data?.error?.message;
  if (apiMessage) {
    return apiMessage;
  }
  return error?.message || 'WhatsApp API request failed.';
};

/**
 * Send a login/verification OTP via Meta WhatsApp authentication template.
 * @param {{ phone_number: string, otp: string }} params
 * @returns {Promise<{ ok: boolean, messageId?: string, message?: string }>}
 */
const sendVerificationOtp = async ({ phone_number, otp }) => {
  const recipient = toWhatsAppRecipient(phone_number);
  if (!recipient) {
    return { ok: false, message: 'Invalid phone number.' };
  }

  if (WHATSAPP_ENABLED) {
    try {
      assertWhatsAppConfigured();

      const url = `${GRAPH_API_BASE}/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'template',
        template: {
          name: WHATSAPP_OTP_TEMPLATE_NAME,
          language: { code: WHATSAPP_OTP_TEMPLATE_LANGUAGE },
          components: buildAuthenticationTemplateComponents(otp),
        },
      };

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      const messageId = response?.data?.messages?.[0]?.id;
      return { ok: true, messageId: messageId || null };
    } catch (error) {
      const message = mapWhatsAppError(error);
      console.error('[whatsapp] sendVerificationOtp failed:', message);
      return { ok: false, message };
    }
  }

  if (WHATSAPP_OTP_DEV_FALLBACK && NODE_ENV !== 'production') {
    console.log(
      `[whatsapp][dev-fallback] OTP for ${maskPhoneForLog(phone_number)}: ${otp}`
    );
    return { ok: true, messageId: 'dev-fallback' };
  }

  return { ok: false, message: 'OTP delivery is not configured.' };
};

module.exports = {
  sendVerificationOtp,
};
