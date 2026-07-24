const crypto = require('crypto');
const {
  WHATSAPP_APP_SECRET,
  WHATSAPP_WEBHOOK_SKIP_SIGNATURE_VERIFY,
  NODE_ENV,
} = require('../../../config/env');

const getRawBodyBuffer = (req) => {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return Buffer.from(req.body);
  }
  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body));
  }
  return Buffer.from('');
};

const verifyWhatsAppWebhookSignature = (req) => {
  if (WHATSAPP_WEBHOOK_SKIP_SIGNATURE_VERIFY && NODE_ENV !== 'production') {
    return true;
  }

  if (!WHATSAPP_APP_SECRET) {
    console.error('[whatsapp-webhook] WHATSAPP_APP_SECRET is not configured.');
    return false;
  }

  const signatureHeader = req.headers['x-hub-signature-256'];
  if (!signatureHeader) {
    return false;
  }

  const provided = String(signatureHeader).startsWith('sha256=')
    ? String(signatureHeader).slice(7)
    : String(signatureHeader);

  const expected = crypto
    .createHmac('sha256', WHATSAPP_APP_SECRET)
    .update(getRawBodyBuffer(req))
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
};

const parseWebhookJsonBody = (req) => {
  const raw = getRawBodyBuffer(req);
  if (!raw.length) {
    return {};
  }
  return JSON.parse(raw.toString('utf8'));
};

module.exports = {
  verifyWhatsAppWebhookSignature,
  parseWebhookJsonBody,
};
