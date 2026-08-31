const {
    parseWebhookRequest,
} = require('../src/modules/apple_iap');
const {
    handleAppleNotification,
} = require('../services/mobile/partner/apple_iap_subscription_service');

const handleAppleIapNotification = async (req, res) => {
    try {
        const { signedPayload } = parseWebhookRequest(req);
        if (!signedPayload) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'signedPayload is required.',
            });
        }

        const result = await handleAppleNotification(signedPayload);
        return res.status(200).json({
            success: true,
            status: 200,
            message: 'Apple IAP notification processed',
            result,
        });
    } catch (err) {
        const status = err.status === 400 ? 400 : 500;
        console.error('handleAppleIapNotification', err.message, err.details || '', err.stack || '');
        return res.status(status).json({
            success: false,
            status,
            message:
                status === 400
                    ? 'Apple IAP notification could not be verified.'
                    : 'Apple IAP notification processing error.',
        });
    }
};

module.exports = {
    handleAppleIapNotification,
};
