const { notify } = require("./notification.service");
const OrderPayment = require("../../../../models/order_payment");
const OrderAdditionalCharge = require("../../../../models/order_additional_charge");
const { resolveOrderRecipients } = require("../resolvers/orderRecipients");
const { resolveQuoteRecipients } = require("../resolvers/quoteRecipients");
const { resolveSubscriptionRecipients } = require("../resolvers/subscriptionRecipients");
const { resolveWalletRecipients } = require("../resolvers/walletRecipients");

const runSafe = async (label, fn) => {
  try {
    await fn();
  } catch (error) {
    console.error(`[notifications] ${label}:`, error.message || error);
  }
};

const buildOrderMetadata = (order, extra = {}) => ({
  order_id: order?._id || null,
  order_unique_id: order?.unique_id || "",
  franchise_id: order?.franchise_id || null,
  ...extra,
});

const safeNotifyOrderCreated = async ({ order, actorUserId, serviceItems = [] }) => {
  await runSafe("order.created", async () => {
    const partnerIds = (serviceItems || [])
      .map((item) => item.partner_id)
      .filter(Boolean);
    const recipients = await resolveOrderRecipients(order, { extraUserIds: partnerIds });

    await notify({
      eventKey: "ORDER_CREATED",
      actorUserId,
      recipientUserIds: recipients,
      context: { order },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order),
    });
  });
};

const safeNotifyOrderStatusChanged = async ({
  order,
  previousStatus,
  newStatus,
  actorUserId,
}) => {
  await runSafe("order.status_changed", async () => {
    if (!newStatus || newStatus === previousStatus) return;

    const recipients = await resolveOrderRecipients(order);
    await notify({
      eventKey: "ORDER_STATUS_CHANGED",
      actorUserId,
      recipientUserIds: recipients,
      context: { order, previousStatus, newStatus },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order, { previousStatus, newStatus }),
      dedupeKeyPrefix: `order.status:${order._id}:${newStatus}`,
    });
  });
};

const safeNotifyOrderCancelled = async ({ order, actorUserId }) => {
  await runSafe("order.cancelled", async () => {
    const recipients = await resolveOrderRecipients(order);
    await notify({
      eventKey: "ORDER_CANCELLED",
      actorUserId,
      recipientUserIds: recipients,
      context: { order },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order),
      dedupeKeyPrefix: `order.cancelled:${order._id}`,
    });
  });
};

const safeNotifyOrderServiceStatusChanged = async ({
  order,
  service,
  serviceName,
  newStatus,
  actorUserId,
}) => {
  await runSafe("order.service_status_changed", async () => {
    const recipients = await resolveOrderRecipients(order);
    await notify({
      eventKey: "ORDER_SERVICE_STATUS_CHANGED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        order,
        serviceName,
        newStatus,
        orderUniqueId: service?.order_unique_id || order?.unique_id,
      },
      entityType: "order",
      entityId: order?._id || service?.order_id,
      franchiseId: order?.franchise_id,
      metadata: buildOrderMetadata(order, {
        service_item_id: service?._id,
        newStatus,
      }),
    });
  });
};

const safeNotifyOrderServiceAssigned = async ({
  order,
  partnerUserId,
  serviceName,
  orderUniqueId,
  actorUserId,
}) => {
  await runSafe("order.service_assigned", async () => {
    await notify({
      eventKey: "ORDER_SERVICE_ASSIGNED",
      actorUserId,
      recipientUserIds: [partnerUserId],
      context: { order, serviceName, orderUniqueId },
      entityType: "order",
      entityId: order?._id,
      franchiseId: order?.franchise_id,
      metadata: buildOrderMetadata(order, { serviceName }),
    });
  });
};

const safeNotifyOrderServiceUnassigned = async ({
  order,
  partnerUserId,
  orderUniqueId,
  actorUserId,
}) => {
  await runSafe("order.service_unassigned", async () => {
    await notify({
      eventKey: "ORDER_SERVICE_UNASSIGNED",
      actorUserId,
      recipientUserIds: [partnerUserId],
      context: { order, orderUniqueId },
      entityType: "order",
      entityId: order?._id,
      franchiseId: order?.franchise_id,
      metadata: buildOrderMetadata(order),
    });
  });
};

const safeNotifyOrderServiceTimeUpdated = async ({
  order,
  partnerUserId,
  serviceName,
  orderUniqueId,
  actorUserId,
}) => {
  await runSafe("order.service_time_updated", async () => {
    await notify({
      eventKey: "ORDER_SERVICE_TIME_UPDATED",
      actorUserId,
      recipientUserIds: [partnerUserId],
      context: { order, serviceName, orderUniqueId },
      entityType: "order",
      entityId: order?._id,
      franchiseId: order?.franchise_id,
      metadata: buildOrderMetadata(order, { serviceName }),
    });
  });
};

const safeNotifyOrderServiceCancelled = async ({
  order,
  serviceName,
  orderUniqueId,
  actorUserId,
  extraRecipientIds = [],
}) => {
  await runSafe("order.service_cancelled", async () => {
    const recipients = await resolveOrderRecipients(order, {
      extraUserIds: extraRecipientIds,
    });
    await notify({
      eventKey: "ORDER_SERVICE_CANCELLED",
      actorUserId,
      recipientUserIds: recipients,
      context: { order, serviceName, orderUniqueId },
      entityType: "order",
      entityId: order?._id,
      franchiseId: order?.franchise_id,
      metadata: buildOrderMetadata(order, { serviceName }),
    });
  });
};

const safeNotifyOrderPaymentReceived = async ({
  order,
  payment,
  actorUserId,
}) => {
  await runSafe("order.payment_received", async () => {
    if (!payment || payment.status !== "completed") return;

    const recipients = await resolveOrderRecipients(order);
    await notify({
      eventKey: "ORDER_PAYMENT_RECEIVED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        order,
        amount: payment.amount,
        payerType: payment.payer_type,
        orderUniqueId: order?.unique_id,
      },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order, {
        payment_id: payment._id,
        amount: payment.amount,
        payer_type: payment.payer_type,
      }),
      dedupeKeyPrefix: `order.payment:${payment._id}`,
    });
  });
};

const safeNotifyOrderAdditionalChargeAdded = async ({
  order,
  charge,
  actorUserId,
}) => {
  await runSafe("order.additional_charge_added", async () => {
    const recipients = await resolveOrderRecipients(order);
    await notify({
      eventKey: "ORDER_ADDITIONAL_CHARGE_ADDED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        order,
        amount: charge?.amount,
        label: charge?.label,
        orderUniqueId: order?.unique_id,
      },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order, {
        charge_id: charge?._id,
        amount: charge?.amount,
        label: charge?.label,
      }),
      dedupeKeyPrefix: charge?._id ? `order.charge:${charge._id}` : null,
    });
  });
};

const safeNotifyQuoteCreated = async ({ quote, actorUserId }) => {
  await runSafe("quote.created", async () => {
    const recipients = await resolveQuoteRecipients(quote);
    await notify({
      eventKey: "QUOTE_CREATED",
      actorUserId,
      recipientUserIds: recipients,
      context: { quote },
      entityType: "quote",
      entityId: quote._id,
      franchiseId: quote.franchise_id,
      metadata: {
        quote_id: quote._id,
        quote_sequence_id: quote.quote_sequence_id,
      },
    });
  });
};

const safeNotifyQuoteStatusChanged = async ({
  quote,
  previousStatus,
  newStatus,
  actorUserId,
}) => {
  await runSafe("quote.status_changed", async () => {
    if (!newStatus || newStatus === previousStatus) return;

    const recipients = await resolveQuoteRecipients(quote);
    await notify({
      eventKey: "QUOTE_STATUS_CHANGED",
      actorUserId,
      recipientUserIds: recipients,
      context: { quote, previousStatus, newStatus },
      entityType: "quote",
      entityId: quote._id,
      franchiseId: quote.franchise_id,
      metadata: {
        quote_id: quote._id,
        quote_sequence_id: quote.quote_sequence_id,
        previousStatus,
        newStatus,
      },
      dedupeKeyPrefix: `quote.status:${quote._id}:${newStatus}`,
    });
  });
};

const safeNotifySubscriptionAssigned = async ({
  subscription,
  planName,
  actorUserId,
}) => {
  await runSafe("subscription.assigned", async () => {
    const recipients = await resolveSubscriptionRecipients(subscription);
    await notify({
      eventKey: "SUBSCRIPTION_ASSIGNED",
      actorUserId,
      recipientUserIds: recipients,
      context: { planName },
      entityType: "subscription",
      entityId: subscription._id,
      franchiseId: subscription.franchise_id || null,
      metadata: {
        subscription_id: subscription._id,
        plan_name: planName,
        status: subscription.status,
      },
    });
  });
};

const safeNotifySubscriptionStatusChanged = async ({
  subscription,
  previousStatus,
  newStatus,
  planName,
  actorUserId,
}) => {
  await runSafe("subscription.status_changed", async () => {
    if (!newStatus || newStatus === previousStatus) return;

    const recipients = await resolveSubscriptionRecipients(subscription);
    await notify({
      eventKey: "SUBSCRIPTION_STATUS_CHANGED",
      actorUserId,
      recipientUserIds: recipients,
      context: { newStatus, planName },
      entityType: "subscription",
      entityId: subscription._id,
      franchiseId: subscription.franchise_id || null,
      metadata: {
        subscription_id: subscription._id,
        previousStatus,
        newStatus,
      },
      dedupeKeyPrefix: `subscription.status:${subscription._id}:${newStatus}`,
    });
  });
};

const safeNotifyWalletTransaction = async ({ ledgerEntry, actorUserId }) => {
  await runSafe("wallet.transaction", async () => {
    const recipients = resolveWalletRecipients(ledgerEntry);
    const isCredit = ledgerEntry.transaction_type === "credit";
    const eventKey = isCredit ? "WALLET_CREDIT" : "WALLET_DEBIT";

    await notify({
      eventKey,
      actorUserId,
      recipientUserIds: recipients,
      context: {
        amount: ledgerEntry.amount,
        description: ledgerEntry.description,
      },
      entityType: "wallet",
      entityId: ledgerEntry._id,
      franchiseId: ledgerEntry.franchise_id || null,
      metadata: {
        ledger_id: ledgerEntry._id,
        transaction_type: ledgerEntry.transaction_type,
        amount: ledgerEntry.amount,
        order_id: ledgerEntry.order_id || null,
      },
      dedupeKeyPrefix: `wallet:${ledgerEntry._id}`,
    });
  });
};

const safeNotifyOrderNestedResources = async ({ order, nested, actorUserId }) => {
  await runSafe("order.nested_resources", async () => {
    if (!nested || !order) return;

    const paymentIds = [
      ...(nested.order_payments?.created || []),
      ...(nested.order_payments?.updated || []),
    ];
    if (paymentIds.length) {
      const payments = await OrderPayment.find({ _id: { $in: paymentIds } }).lean();
      for (const payment of payments) {
        if (payment.status === "completed") {
          await safeNotifyOrderPaymentReceived({ order, payment, actorUserId });
        }
      }
    }

    const chargeIds = nested.additional_charges?.created || [];
    if (chargeIds.length) {
      const charges = await OrderAdditionalCharge.find({ _id: { $in: chargeIds } }).lean();
      for (const charge of charges) {
        await safeNotifyOrderAdditionalChargeAdded({ order, charge, actorUserId });
      }
    }
  });
};

const safeNotifyDisputeRaised = async ({ dispute, order, actorUserId }) => {
  await runSafe("dispute.raised", async () => {
    if (!dispute?.employee_id) return;

    await notify({
      eventKey: "DISPUTE_RAISED",
      actorUserId,
      recipientUserIds: [dispute.employee_id],
      context: { dispute, order },
      entityType: "dispute",
      entityId: dispute._id,
      franchiseId: dispute.franchise_id,
      metadata: {
        order_id: order?._id || null,
        order_unique_id: order?.unique_id || "",
        dispute_id: dispute._id,
        dispute_unique_id: dispute.unique_id || "",
        chat_id: dispute.chat_id || null,
      },
      dedupeKeyPrefix: `dispute.raised:${dispute._id}`,
    });
  });
};

module.exports = {
  runSafe,
  safeNotifyOrderCreated,
  safeNotifyOrderStatusChanged,
  safeNotifyOrderCancelled,
  safeNotifyOrderServiceStatusChanged,
  safeNotifyOrderServiceAssigned,
  safeNotifyOrderServiceUnassigned,
  safeNotifyOrderServiceTimeUpdated,
  safeNotifyOrderServiceCancelled,
  safeNotifyOrderPaymentReceived,
  safeNotifyOrderAdditionalChargeAdded,
  safeNotifyOrderNestedResources,
  safeNotifyQuoteCreated,
  safeNotifyQuoteStatusChanged,
  safeNotifySubscriptionAssigned,
  safeNotifySubscriptionStatusChanged,
  safeNotifyWalletTransaction,
  safeNotifyDisputeRaised,
};
