const path = require('path');
const {
    generatePaymentLink,
    verifyWebhookSignature,
    dispatchWebhook,
} = require('../src/modules/payments');

const parseWebhookBody = (req) => {
    if (Buffer.isBuffer(req.body)) {
        const rawBody = req.body;
        const body = JSON.parse(rawBody.toString('utf8'));
        return { rawBody, body };
    }

    return {
        rawBody: req.rawBody || JSON.stringify(req.body),
        body: req.body,
    };
};

const handleRazorpayWebhook = async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const { rawBody, body } = parseWebhookBody(req);

        if (!verifyWebhookSignature(rawBody, signature)) {
            console.log('Razorpay webhook signature mismatch');
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
