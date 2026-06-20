const path = require('path');
const {
    generatePaymentLink,
    verifyWebhookSignature,
    parseWebhookRequest,
    dispatchWebhook,
} = require('../src/modules/payments');

const handleRazorpayWebhook = async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const { rawBody, body } = parseWebhookRequest(req);

        if (!verifyWebhookSignature(rawBody, signature)) {
            console.log('Razorpay webhook signature mismatch', {
                hasApiGatewayEvent: Boolean(req.apiGateway?.event),
                bodyType: Buffer.isBuffer(req.body) ? 'buffer' : typeof req.body,
            });
            return res.status(400).send('Invalid signature');
        }

        const dispatchResult = await dispatchWebhook(body);

        if (!dispatchResult.ok) {
            const status = dispatchResult.noRetry ? 200 : 500;
            if (dispatchResult.noRetry) {
                console.error('Razorpay webhook processed with non-retryable failure', dispatchResult.results);
            }
            return res.status(status).json({
                success: false,
                status,
                message: dispatchResult.noRetry
                    ? 'Razorpay webhook received but fulfillment failed (non-retryable).'
                    : 'Razorpay webhook fulfillment failed.',
                results: dispatchResult.results,
            });
        }

        return res.status(200).json({
            success: true,
            status: 200,
            message: 'Razorpay webhook processed',
            results: dispatchResult.results,
        });
    } catch (err) {
        console.error('handleRazorpayWebhook', err.message, err.stack || '');
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Razorpay webhook processing error.',
        });
    }
};

const razorpayCallback = async (req, res) => {
    res.sendFile(path.join(__dirname, '../public/html/success.html'));
};

module.exports = { generatePaymentLink, handleRazorpayWebhook, razorpayCallback };
