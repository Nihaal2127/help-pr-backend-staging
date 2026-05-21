const mongoose = require('mongoose');
const Order = require('../models/order');
const OrderService = require('../models/order_services');
const OrderPayment = require('../models/order_payment');
const PartnerWalletLedger = require('../models/partner_wallet_ledger');
const {
    ORDER_STATUS_CANCELLED,
    ORDER_STATUS_REFUNDED,
} = require('../enum/order_status_enum');

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

const isOrderCreditLedgerRow = {
    transaction_type: 'credit',
    deleted_at: null,
    order_payment_id: null,
    payout_id: null,
    $or: [{ financial_order_id: null }, { financial_order_id: { $exists: false } }],
};

const computeOrderPartnerCreditAmount = async (orderDoc) => {
    const order =
        orderDoc && orderDoc.partner_id !== undefined
            ? orderDoc
            : await Order.findOne({ _id: orderDoc, deleted_at: null }).lean();
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
    const additionalChargesBase = roundAmount(order.additional_charges_subtotal || 0);
    const amount = roundAmount(partnerEarning + additionalChargesBase);

    return {
        partnerId: order.partner_id,
        franchiseId: order.franchise_id || null,
        amount,
        order,
    };
};

/**
 * Upsert order-level wallet credit: partner_earning + additional_charges_subtotal (base only).
 */
const syncOrderPartnerWalletCredit = async (orderId) => {
    try {
        const order = await Order.findOne({ _id: orderId, deleted_at: null }).lean();
        if (!order) return;

        const computed = await computeOrderPartnerCreditAmount(order);
        if (!computed) return;

        const { partnerId, franchiseId, amount } = computed;
        const creditFilter = {
            order_id: order._id,
            ...isOrderCreditLedgerRow,
        };

        const now = new Date();
        const description = `Order ${order.unique_id || order._id} — partner earning`;

        if (amount <= 0) {
            await PartnerWalletLedger.updateMany(creditFilter, {
                $set: { deleted_at: now, updated_at: now },
            });
            return;
        }

        const existing = await PartnerWalletLedger.findOne(creditFilter);
        const date = order.order_date || order.created_at || now;

        if (existing) {
            await PartnerWalletLedger.updateOne(
                { _id: existing._id },
                {
                    $set: {
                        partner_id: partnerId,
                        franchise_id: franchiseId,
                        amount,
                        date,
                        description,
                        order_unique_id: order.unique_id || null,
                        updated_at: now,
                        deleted_at: null,
                    },
                }
            );
            return;
        }

        await PartnerWalletLedger.create({
            partner_id: partnerId,
            franchise_id: franchiseId,
            transaction_type: 'credit',
            amount,
            date,
            description,
            payment_method: null,
            order_id: order._id,
            order_unique_id: order.unique_id || null,
            financial_order_id: null,
            order_payment_id: null,
            payout_id: null,
            created_at: now,
            updated_at: now,
            deleted_at: null,
        });
    } catch (err) {
        console.error('syncOrderPartnerWalletCredit', err.message);
    }
};

/**
 * Debit partner wallet for a completed partner order_payment; reverse when not completed or deleted.
 */
const syncPartnerOrderPaymentWallet = async (paymentDoc) => {
    try {
        const payment =
            paymentDoc && paymentDoc.payer_type !== undefined
                ? paymentDoc
                : await OrderPayment.findById(paymentDoc).lean();
        if (!payment || payment.payer_type !== 'partner') return;

        const order = await Order.findOne({
            _id: payment.order_id,
            deleted_at: null,
        }).lean();
        if (!order?.partner_id) return;

        const debitFilter = {
            order_payment_id: payment._id,
            transaction_type: 'debit',
            deleted_at: null,
        };

        const isActive =
            !payment.deleted_at && payment.status === 'completed';
        const amount = roundAmount(payment.amount);
        const now = new Date();

        if (!isActive || amount <= 0) {
            await PartnerWalletLedger.updateMany(debitFilter, {
                $set: { deleted_at: now, updated_at: now },
            });
            return;
        }

        const date = payment.paid_at || payment.created_at || now;
        const description = `Partner payment for order ${order.unique_id || order._id}`;

        const existing = await PartnerWalletLedger.findOne(debitFilter);
        const payload = {
            partner_id: order.partner_id,
            franchise_id: order.franchise_id || null,
            transaction_type: 'debit',
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

        if (existing) {
            await PartnerWalletLedger.updateOne({ _id: existing._id }, { $set: payload });
            return;
        }

        await PartnerWalletLedger.create({
            ...payload,
            created_at: now,
        });
    } catch (err) {
        console.error('syncPartnerOrderPaymentWallet', err.message);
    }
};

const syncAllPartnerOrderPaymentsForOrder = async (orderId) => {
    const payments = await OrderPayment.find({
        order_id: orderId,
        payer_type: 'partner',
    }).lean();
    for (const payment of payments) {
        await syncPartnerOrderPaymentWallet(payment);
    }
};

module.exports = {
    computeOrderPartnerCreditAmount,
    syncOrderPartnerWalletCredit,
    syncPartnerOrderPaymentWallet,
    syncAllPartnerOrderPaymentsForOrder,
};
