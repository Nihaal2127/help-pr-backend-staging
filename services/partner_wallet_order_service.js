const Order = require('../models/order');
const OrderService = require('../models/order_services');
const OrderPayment = require('../models/order_payment');
const OrderAdditionalCharge = require('../models/order_additional_charge');
const PartnerWalletLedger = require('../models/partner_wallet_ledger');
const { aggregateAdditionalCharges } = require('../utils/order_pricing');
const { computeCustomerPaymentStatus } = require('../enum/order_payment_status_enum');
const { safeNotifyWalletTransaction } = require('../src/modules/notifications/services/domainHooks');
const {
    ORDER_STATUS_CANCELLED,
    ORDER_STATUS_REFUNDED,
} = require('../enum/order_status_enum');

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

const PAYMENT_ENTITLEMENT_TOLERANCE = 0.01;

/** Legacy order-level credit rows (pre payment-based wallet). */
const isLegacyOrderLevelCreditFilter = (orderId) => ({
    order_id: orderId,
    transaction_type: 'credit',
    deleted_at: null,
    order_payment_id: null,
    payout_id: null,
    $or: [{ financial_order_id: null }, { financial_order_id: { $exists: false } }],
});

const loadActiveAdditionalChargeRows = async (orderId) =>
    OrderAdditionalCharge.find({
        order_id: orderId,
        $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }],
    }).lean();

/**
 * Partner wallet entitlement for an order: partner_earning + base additional charges.
 * Aggregates additional charges from active charge rows (not only order.additional_charges_subtotal)
 * so nested create/update with charges + partner payments in one request stays correct.
 */
const computeOrderPartnerCreditAmount = async (orderDoc) => {
    const orderId = orderDoc?._id ?? orderDoc;
    const order = await Order.findOne({ _id: orderId, deleted_at: null }).lean();
    if (!order || !order.partner_id) {
        return null;
    }

    if (
        order.order_status === ORDER_STATUS_CANCELLED ||
        order.order_status === ORDER_STATUS_REFUNDED
    ) {
        return {
            partnerId: order.partner_id,
            franchiseId: order.franchise_id || null,
            amount: 0,
            order,
        };
    }

    let partnerEarning = 0;
    const serviceId = order.service_items?.[0];
    if (serviceId) {
        const line = await OrderService.findOne({
            _id: serviceId,
            deleted_at: null,
        })
            .select('partner_earning service_status')
            .lean();
        if (
            line &&
            line.service_status !== ORDER_STATUS_CANCELLED &&
            line.service_status !== ORDER_STATUS_REFUNDED
        ) {
            partnerEarning = roundAmount(line.partner_earning);
        }
    }

    /** Partner receives base additional charge amounts only (not tax or commission). */
    const chargeRows = await loadActiveAdditionalChargeRows(order._id);
    const additionalAgg = aggregateAdditionalCharges(chargeRows);
    const additionalChargesBase = roundAmount(additionalAgg.additional_charges_subtotal || 0);
    const amount = roundAmount(partnerEarning + additionalChargesBase);

    return {
        partnerId: order.partner_id,
        franchiseId: order.franchise_id || null,
        amount,
        order,
    };
};

const softDeleteLedgerRows = async (filter) => {
    const now = new Date();
    await PartnerWalletLedger.updateMany(filter, {
        $set: { deleted_at: now, updated_at: now },
    });
};

const softDeleteLegacyOrderLevelCredits = async (orderId) => {
    await softDeleteLedgerRows(isLegacyOrderLevelCreditFilter(orderId));
};

const softDeleteLegacyPartnerPaymentDebitsForOrder = async (orderId) => {
    const payments = await OrderPayment.find({
        order_id: orderId,
        payer_type: 'partner',
    })
        .select('_id')
        .lean();
    const paymentIds = payments.map((p) => p._id);
    if (!paymentIds.length) return;
    await softDeleteLedgerRows({
        order_payment_id: { $in: paymentIds },
        transaction_type: 'debit',
        deleted_at: null,
    });
};

/**
 * Sync partner wallet credits from completed partner order_payment rows.
 * Credits are not created on order create; each completed partner payment credits the wallet
 * up to order entitlement (partner_earning + additional_charges_subtotal base).
 */
const syncAllPartnerOrderPaymentsForOrder = async (orderId) => {
    try {
        const order = await Order.findOne({ _id: orderId, deleted_at: null }).lean();
        if (!order?.partner_id) return;

        await softDeleteLegacyOrderLevelCredits(orderId);
        await softDeleteLegacyPartnerPaymentDebitsForOrder(orderId);

        const computed = await computeOrderPartnerCreditAmount(order);
        const allPayments = await OrderPayment.find({
            order_id: orderId,
            deleted_at: null,
        }).lean();
        const customer = computeCustomerPaymentStatus(
            Number(order.total_price) || 0,
            allPayments
        );
        const entitlement = roundAmount(
            Math.min(computed?.amount ?? 0, customer.customer_net_paid ?? 0)
        );
        const partnerId = computed?.partnerId ?? order.partner_id;
        const franchiseId = (computed?.franchiseId ?? order.franchise_id) || null;

        const payments = await OrderPayment.find({
            order_id: orderId,
            payer_type: 'partner',
        })
            .sort({ created_at: 1, _id: 1 })
            .lean();

        let creditedSoFar = 0;
        const now = new Date();

        for (const payment of payments) {
            const creditFilter = {
                order_payment_id: payment._id,
                transaction_type: 'credit',
                deleted_at: null,
            };

            const isActive =
                !payment.deleted_at &&
                payment.status === 'completed' &&
                entitlement > PAYMENT_ENTITLEMENT_TOLERANCE;

            if (!isActive) {
                await softDeleteLedgerRows(creditFilter);
                continue;
            }

            const remainingEntitlement = roundAmount(entitlement - creditedSoFar);
            if (remainingEntitlement <= PAYMENT_ENTITLEMENT_TOLERANCE) {
                await softDeleteLedgerRows(creditFilter);
                continue;
            }

            const amount = roundAmount(
                Math.min(roundAmount(payment.amount), remainingEntitlement)
            );
            if (amount <= 0) {
                await softDeleteLedgerRows(creditFilter);
                continue;
            }

            const date = payment.paid_at || payment.created_at || now;
            const description = `Partner payment for order ${order.unique_id || order._id}`;

            const payload = {
                partner_id: partnerId,
                franchise_id: franchiseId,
                transaction_type: 'credit',
                amount,
                date,
                description,
                payment_method: payment.payment_method || null,
                order_id: order._id,
                order_unique_id: order.unique_id || null,
                financial_order_id: null,
                order_payment_id: payment._id,
                payout_id: null,
                updated_at: now,
                deleted_at: null,
            };

            const existing = await PartnerWalletLedger.findOne(creditFilter);
            if (existing) {
                await PartnerWalletLedger.updateOne({ _id: existing._id }, { $set: payload });
            } else {
                const created = await PartnerWalletLedger.create({
                    ...payload,
                    created_at: now,
                });
                void safeNotifyWalletTransaction({
                    ledgerEntry: created,
                    actorUserId: null,
                });
            }

            creditedSoFar = roundAmount(creditedSoFar + amount);
        }
    } catch (err) {
        console.error('syncAllPartnerOrderPaymentsForOrder', err.message);
    }
};

/**
 * Re-sync wallet for one partner payment (delegates to order-level sync for caps).
 */
const syncPartnerOrderPaymentWallet = async (paymentDoc) => {
    try {
        const payment =
            paymentDoc && paymentDoc.payer_type !== undefined
                ? paymentDoc
                : await OrderPayment.findById(paymentDoc).lean();
        if (!payment || payment.payer_type !== 'partner') return;
        await syncAllPartnerOrderPaymentsForOrder(payment.order_id);
    } catch (err) {
        console.error('syncPartnerOrderPaymentWallet', err.message);
    }
};

/** @deprecated Use syncAllPartnerOrderPaymentsForOrder. Kept for call-site compatibility. */
const syncOrderPartnerWalletCredit = async (orderId) => {
    await syncAllPartnerOrderPaymentsForOrder(orderId);
};

module.exports = {
    computeOrderPartnerCreditAmount,
    syncOrderPartnerWalletCredit,
    syncPartnerOrderPaymentWallet,
    syncAllPartnerOrderPaymentsForOrder,
};
