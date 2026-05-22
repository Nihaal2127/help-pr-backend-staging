const OrderPayment = require('../models/order_payment');
const {
    computeOrderPartnerCreditAmount,
} = require('./partner_wallet_order_service');
const {
    computeCustomerPaymentStatus,
    PAYMENT_STATUS_TOLERANCE,
    ORDER_PAYMENT_STATUS_REFUND,
} = require('../enum/order_payment_status_enum');

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

const getCustomerCollectionForOrder = async (order) => {
    const payments = await OrderPayment.find({
        order_id: order._id,
        payer_type: 'customer',
        deleted_at: null,
    }).lean();
    return computeCustomerPaymentStatus(Number(order.total_price) || 0, payments);
};

const sumCompletedPartnerPayments = async (orderId, excludePaymentId = null) => {
    const rows = await OrderPayment.find({
        order_id: orderId,
        payer_type: 'partner',
        status: 'completed',
        deleted_at: null,
    }).lean();

    let sum = 0;
    for (const row of rows) {
        if (
            excludePaymentId &&
            row._id.toString() === excludePaymentId.toString()
        ) {
            continue;
        }
        sum += roundAmount(row.amount);
    }
    return roundAmount(sum);
};

/**
 * Partner order_payment (completed) only when customer has collected funds on the order,
 * cumulative partner payments cannot exceed customer_net_paid, and cannot exceed order
 * partner entitlement (partner_earning + additional_charges_subtotal base).
 */
const validatePartnerOrderPayment = async (
    order,
    { amount, status, excludePaymentId = null }
) => {
    const st = String(status || '').toLowerCase();
    if (st !== 'completed') {
        return { ok: true };
    }

    const paymentAmount = roundAmount(amount);
    if (paymentAmount < 0) {
        return {
            ok: false,
            status: 400,
            message: 'amount must be >= 0.',
        };
    }

    const customer = await getCustomerCollectionForOrder(order);
    const netPaid = customer.customer_net_paid;

    if (netPaid <= PAYMENT_STATUS_TOLERANCE) {
        return {
            ok: false,
            status: 400,
            message:
                'Cannot record a completed partner payment until the customer has paid for this order.',
        };
    }

    if (customer.payment_status === ORDER_PAYMENT_STATUS_REFUND) {
        return {
            ok: false,
            status: 400,
            message:
                'Cannot record a completed partner payment while the order is fully refunded.',
        };
    }

    const alreadyFromPartner = await sumCompletedPartnerPayments(
        order._id,
        excludePaymentId
    );
    const totalAfter = roundAmount(alreadyFromPartner + paymentAmount);

    if (totalAfter > netPaid + PAYMENT_STATUS_TOLERANCE) {
        const maxAdditional = roundAmount(Math.max(0, netPaid - alreadyFromPartner));
        return {
            ok: false,
            status: 400,
            message: `Partner payment exceeds customer collections for this order. Maximum additional partner payment: ${maxAdditional} (customer net paid: ${netPaid}, partner already recorded: ${alreadyFromPartner}).`,
        };
    }

    const entitlement = await computeOrderPartnerCreditAmount(order);
    const maxPartnerEntitlement = entitlement?.amount ?? 0;
    if (totalAfter > maxPartnerEntitlement + PAYMENT_STATUS_TOLERANCE) {
        const maxAdditional = roundAmount(
            Math.max(0, maxPartnerEntitlement - alreadyFromPartner)
        );
        return {
            ok: false,
            status: 400,
            message: `Partner payment exceeds partner entitlement on this order (service earning + base additional charges). Maximum additional partner payment: ${maxAdditional} (order partner entitlement: ${maxPartnerEntitlement}, partner already recorded: ${alreadyFromPartner}).`,
        };
    }

    return {
        ok: true,
        customer_net_paid: netPaid,
        partner_already_recorded: alreadyFromPartner,
        remaining_partner_allowance: roundAmount(
            Math.max(0, netPaid - alreadyFromPartner - paymentAmount)
        ),
    };
};

module.exports = {
    validatePartnerOrderPayment,
    getCustomerCollectionForOrder,
    sumCompletedPartnerPayments,
};
