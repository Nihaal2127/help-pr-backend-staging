const {
  WHATSAPP_WEBHOOK_VERIFY_TOKEN,
} = require('../config/env');
const {
  verifyWhatsAppWebhookSignature,
  parseWebhookJsonBody,
} = require('../src/modules/whatsapp/webhook.signature');
const { dispatchWhatsAppWebhook } = require('../src/modules/whatsapp/webhook.dispatcher');

const handleWhatsAppWebhookVerify = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(String(challenge));
  }

  console.error('[whatsapp-webhook] verification failed', {
    mode,
    hasToken: Boolean(token),
  });

  return res.sendStatus(403);
};

const handleWhatsAppWebhookEvent = async (req, res) => {
  try {
    if (!verifyWhatsAppWebhookSignature(req)) {
      console.error('[whatsapp-webhook] invalid signature');
      return res.sendStatus(403);
    }

    const body = parseWebhookJsonBody(req);
    const dispatchResult = await dispatchWhatsAppWebhook(body);

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'WhatsApp webhook processed.',
      results: dispatchResult.results,
    });
  } catch (error) {
    console.error('[whatsapp-webhook] processing error:', error.message, error.stack || '');
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'WhatsApp webhook processing error.',
    });
  }
};

module.exports = {
  handleWhatsAppWebhookVerify,
  handleWhatsAppWebhookEvent,
};
