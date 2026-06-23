const axios = require('axios');
const crypto = require('crypto');
const {
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_BASE_URL,
} = require('../../../config/env');

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

const getAuthConfig = () => ({
    auth: {
        username: RAZORPAY_KEY_ID,
        password: RAZORPAY_KEY_SECRET,
    },
});

const assertConfigured = () => {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        throw new Error('Razorpay API keys are not configured.');
    }
};

/**
 * Create a Razorpay payment link.
 * @param {object} params
 * @param {number} params.amount - Amount in INR (rupees, not paise)
 * @param {string} [params.currency='INR']
 * @param {{ name: string, email?: string, contact?: string }} params.customer
 * @param {Record<string, string>} [params.notes]
 * @param {string} [params.referenceId]
 * @param {string} [params.callbackUrl]
 * @param {string} [params.description]
 */
const createPaymentLink = async ({
    amount,
    currency = 'INR',
    customer,
    notes = {},
    referenceId,
    callbackUrl,
    description,
}) => {
    assertConfigured();

    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
        throw new Error('Payment amount must be greater than zero.');
    }

    const payload = {
        amount: Math.round(rupees * 100),
        currency,
        accept_partial: false,
        customer: {
            name: customer.name,
            email: customer.email || undefined,
            contact: customer.contact || undefined,
        },
        notify: {
            sms: Boolean(customer.contact),
            email: Boolean(customer.email),
        },
        reminder_enable: true,
        callback_method: 'get',
    };

    const resolvedCallbackUrl =
        callbackUrl || (RAZORPAY_BASE_URL ? `${RAZORPAY_BASE_URL}/api/razorpay/callback` : null);
    if (!resolvedCallbackUrl) {
        throw new Error('RAZORPAY_BASE_URL is not configured (public URL for Razorpay callbacks).');
    }
    payload.callback_url = resolvedCallbackUrl;

    if (description) {
        payload.description = description;
    }
    if (referenceId) {
        payload.reference_id = referenceId;
    }
    if (notes && Object.keys(notes).length > 0) {
        payload.notes = notes;
    }

    const response = await axios.post(`${RAZORPAY_API_BASE}/payment_links`, payload, getAuthConfig());

    return {
        payment_link_id: response.data.id,
        payment_url: response.data.short_url,
        status: response.data.status,
        amount: rupees,
        raw: response.data,
    };
};

/**
 * Fetch a Razorpay payment link by id (e.g. plink_xxx).
 */
const fetchPaymentLink = async (paymentLinkId) => {
    assertConfigured();
    const id = String(paymentLinkId || '').trim();
    if (!id) {
        throw new Error('Payment link id is required.');
    }
    const response = await axios.get(`${RAZORPAY_API_BASE}/payment_links/${id}`, getAuthConfig());
    return response.data;
};

/**
 * Resolve raw webhook body (Lambda API Gateway + local express.raw).
 * @param {import('express').Request} req
 */
const resolveWebhookRawBody = (req) => {
    const event = req.apiGateway?.event;
    if (event?.body != null) {
        if (event.isBase64Encoded) {
            return Buffer.from(event.body, 'base64');
        }
        return typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
    }

    if (Buffer.isBuffer(req.body)) {
        return req.body;
    }
    if (typeof req.body === 'string') {
        return req.body;
    }
    if (req.body && typeof req.body === 'object') {
        return JSON.stringify(req.body);
    }
    return '';
};

/**
 * Parse verified webhook JSON from the request.
 * @param {import('express').Request} req
 */
const parseWebhookRequest = (req) => {
    const rawBody = resolveWebhookRawBody(req);
    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    return {
        rawBody,
        body: bodyString ? JSON.parse(bodyString) : {},
    };
};

/**
 * Verify Razorpay webhook HMAC signature against the raw request body.
 * @param {Buffer|string|object} rawBody - Raw webhook body (Buffer preferred)
 * @param {string} signature - x-razorpay-signature header
 */
const verifyWebhookSignature = (rawBody, signature) => {
    if (!RAZORPAY_WEBHOOK_SECRET) {
        console.warn('RAZORPAY_WEBHOOK_SECRET is not configured.');
        return false;
    }
    if (!signature) {
        return false;
    }

    let payload = rawBody;
    if (Buffer.isBuffer(rawBody)) {
        payload = rawBody;
    } else if (typeof rawBody === 'string') {
        payload = rawBody;
    } else {
        payload = JSON.stringify(rawBody);
    }

    const generatedSignature = crypto
        .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');

    return generatedSignature === signature;
};

/**
 * Refund a captured Razorpay payment (full or partial).
 * @param {object} params
 * @param {string} params.paymentId - Razorpay pay_xxx id
 * @param {number} [params.amountRupees] - Partial refund in INR; omit for full remaining balance
 * @param {Record<string, string>} [params.notes]
 */
const createPaymentRefund = async ({ paymentId, amountRupees, notes = {} }) => {
    assertConfigured();

    const id = String(paymentId || '').trim();
    if (!id) {
        throw new Error('Razorpay payment id is required.');
    }

    const payload = {};
    if (amountRupees != null && amountRupees !== '') {
        const rupees = Number(amountRupees);
        if (!Number.isFinite(rupees) || rupees <= 0) {
            throw new Error('Refund amount must be greater than zero.');
        }
        payload.amount = Math.round(rupees * 100);
    }
    if (notes && Object.keys(notes).length > 0) {
        payload.notes = notes;
    }

    const response = await axios.post(
        `${RAZORPAY_API_BASE}/payments/${id}/refund`,
        payload,
        getAuthConfig()
    );

    return response.data;
};

module.exports = {
    createPaymentLink,
    fetchPaymentLink,
    createPaymentRefund,
    verifyWebhookSignature,
    resolveWebhookRawBody,
    parseWebhookRequest,
};
