const {
  parseBunnyWebhookRequest,
  verifyBunnyWebhookSignature,
} = require('../services/bunny_stream_service');
const { applyWebhookStatusToPost } = require('../services/partner_post_video_service');

const handleBunnyStreamWebhook = async (req, res) => {
  try {
    const { rawBody, body } = parseBunnyWebhookRequest(req);

    if (!verifyBunnyWebhookSignature(rawBody, req.headers)) {
      console.log('Bunny Stream webhook signature mismatch', {
        hasApiGatewayEvent: Boolean(req.apiGateway?.event),
        bodyType: Buffer.isBuffer(req.body) ? 'buffer' : typeof req.body,
      });
      return res.status(401).send('Invalid signature');
    }

    await applyWebhookStatusToPost(body);
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Bunny Stream webhook processed.',
    });
  } catch (error) {
    console.error('handleBunnyStreamWebhook', error.message, error.stack || '');
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Bunny Stream webhook processing error.',
    });
  }
};

module.exports = { handleBunnyStreamWebhook };
