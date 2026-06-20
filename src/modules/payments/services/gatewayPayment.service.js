const GatewayPayment = require('../../../../models/gateway_payment');
const { GATEWAY_PAYMENT_METHOD } = require('../constants/payment.constants');

const normalizeInstrumentType = (raw) => {
    if (raw == null || raw === '') {
        return null;
    }
    const value = String(raw).trim().toLowerCase();
    const allowed = ['card', 'upi', 'netbanking', 'wallet', 'emi'];
    return allowed.includes(value) ? value : 'other';
};

/**
 * Extract Razorpay pay_xxx id from a payment link API response.
 * @param {object} link
 */
const extractPaymentIdFromLink = (link) => {
    const payments = link?.payments;
    if (!Array.isArray(payments) || !payments.length) {
        return null;
    }
    const first = payments[0];
    return first?.payment_id || first?.id || null;
};

/**
 * Record or update a gateway payment row (idempotent by gateway_payment_id or link id).
 */
const recordGatewayPayment = async (
    {
        purpose,
        referenceId,
        payerType,
        payerId,
        amount,
        currency = 'INR',
        status = 'completed',
        gatewayPaymentLinkId,
        gatewayPaymentId,
        instrumentType,
        paidAt,
        notes,
    },
    session = null
) => {
    const now = new Date();
    const normalizedPaymentId = gatewayPaymentId ? String(gatewayPaymentId).trim() : null;
    const normalizedLinkId = gatewayPaymentLinkId ? String(gatewayPaymentLinkId).trim() : null;

    if (normalizedPaymentId) {
        const existing = await GatewayPayment.findOne({
            gateway_payment_id: normalizedPaymentId,
            deleted_at: null,
        })
            .session(session || null)
            .lean();

        if (existing) {
            return existing;
        }
    }

    if (normalizedLinkId) {
        const existingByLink = await GatewayPayment.findOne({
            purpose,
            reference_id: referenceId,
            gateway_payment_link_id: normalizedLinkId,
            status: 'completed',
            deleted_at: null,
        })
            .session(session || null)
            .lean();

        if (existingByLink) {
            return existingByLink;
        }
    }

    const doc = {
        gateway: 'razorpay',
        purpose,
        reference_id: referenceId,
        payer_type: payerType,
        payer_id: payerId,
        amount,
        currency,
        status,
        payment_method: GATEWAY_PAYMENT_METHOD,
        gateway_payment_link_id: normalizedLinkId,
        gateway_payment_id: normalizedPaymentId,
        instrument_type: normalizeInstrumentType(instrumentType),
        paid_at: paidAt || now,
        notes: notes || '',
        created_at: now,
        updated_at: now,
    };

    const [row] = await GatewayPayment.create([doc], { session });
    return row?.toObject ? row.toObject() : row;
};

module.exports = {
    recordGatewayPayment,
    extractPaymentIdFromLink,
    normalizeInstrumentType,
};
