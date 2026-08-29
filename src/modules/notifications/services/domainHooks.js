const mongoose = require("mongoose");
const { notify } = require("./notification.service");
const OrderPayment = require("../../../../models/order_payment");
const OrderAdditionalCharge = require("../../../../models/order_additional_charge");
const OrderService = require("../../../../models/order_services");
const { formatAmount } = require("../constants/notification_events");
const { normalizeQuoteStatus, shouldIncludePartnerInQuoteNotify } = require("../../../../enum/quote_status_enum");
const { resolveOrderRecipients } = require("../resolvers/orderRecipients");
const { resolveQuoteRecipients } = require("../resolvers/quoteRecipients");
const { resolveSubscriptionRecipients } = require("../resolvers/subscriptionRecipients");
const { resolveWalletRecipients } = require("../resolvers/walletRecipients");
const {
  safeNotifyBackofficeQuoteCreated,
  safeNotifyBackofficeQuoteStatusChanged,
  safeNotifyBackofficeOrderCreated,
  safeNotifyBackofficeOrderStatusChanged,
  safeNotifyBackofficeOrderPayment,
  safeNotifyBackofficeSubscriptionChanged,
  safeNotifyBackofficeOrderReviewReceived,
} = require("./backofficeHooks");

const runSafe = async (label, fn) => {
  try {
    await fn();
  } catch (error) {
    console.error(`[notifications] ${label}:`, error.message || error);
  }
};

const truncatePostDescription = (value, maxLen = 60) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
};

const buildOrderMetadata = (order, extra = {}) => ({
  order_id: order?._id || null,
  order_unique_id: order?.unique_id || "",
  franchise_id: order?.franchise_id || null,
  ...extra,
});

const addRecipientId = (set, value) => {
  if (value == null || value === "") return;
  const id = typeof value === "object" && value._id != null ? value._id : value;
  if (id == null || id === "") return;
  const key = String(id);
  if (!key || key === "[object Object]") return;
  set.add(key);
};

const collectOrderPartnerUserIds = async (order) => {
  const ids = new Set();
  addRecipientId(ids, order?.partner_id);

  const serviceItemIds = order?.service_items || [];
  const objectIds = serviceItemIds
    .map((item) =>
      item && typeof item === "object" && item._id != null ? item._id : item
    )
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  if (objectIds.length) {
    const lines = await OrderService.find({ _id: { $in: objectIds } })
      .select("partner_id")
      .lean();
    lines.forEach((line) => addRecipientId(ids, line.partner_id));
  }

  return [...ids];
};

const safeNotifyOrderCreated = async ({ order, actorUserId, serviceItems = [] }) => {
  await runSafe("order.created", async () => {
    const partnerIds = (serviceItems || [])
      .map((item) => item.partner_id)
      .filter(Boolean);
    // ORDER_CREATED: customer, partner(s), assigned employee, franchise admin(s).
    // Mobile push when user/partner have device_token. Actor (e.g. backoffice user) excluded.
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
      dedupeKeyPrefix: `order.created:${order._id}`,
    });
    void safeNotifyBackofficeOrderCreated({ order, actorUserId });
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
    void safeNotifyBackofficeOrderStatusChanged({ order, newStatus, actorUserId });
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
    void safeNotifyBackofficeOrderStatusChanged({
      order,
      newStatus: "cancelled",
      actorUserId,
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
      dedupeKeyPrefix: service?._id
        ? `order.service.status:${service._id}:${newStatus}`
        : `order.service.status:${order._id}:${newStatus}`,
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
      dedupeKeyPrefix: `order.service.assigned:${order._id}:${partnerUserId}`,
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
      dedupeKeyPrefix: `order.service.unassigned:${order._id}:${partnerUserId}`,
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
      dedupeKeyPrefix: `order.service.time:${order._id}:${partnerUserId}:${serviceName || "service"}`,
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
      dedupeKeyPrefix: `order.service.cancelled:${order._id}:${serviceName || "service"}`,
    });
  });
};

const excludeUserId = (recipientIds, userId) => {
  if (userId == null || userId === "") return recipientIds;
  const excluded = String(userId);
  return recipientIds.filter((id) => String(id) !== excluded);
};

const resolveOrderPaymentPayerUserId = (order, payment, actorUserId) => {
  const payerType = String(payment?.payer_type || "customer").toLowerCase();
  if (payerType === "partner") {
    return actorUserId || order?.partner_id || null;
  }
  return order?.user_id || actorUserId || null;
};

const safeNotifyOrderPaymentReceived = async ({
  order,
  payment,
  actorUserId,
}) => {
  await runSafe("order.payment_received", async () => {
    if (!payment || payment.status !== "completed" || !order?._id) return;

    const payerType = String(payment.payer_type || "customer").toLowerCase();
    const payerUserId = resolveOrderPaymentPayerUserId(order, payment, actorUserId);
    const paymentContext = {
      order,
      amount: payment.amount,
      payerType,
      orderUniqueId: order?.unique_id,
    };
    const paymentMetadata = buildOrderMetadata(order, {
      payment_id: payment._id,
      amount: payment.amount,
      payer_type: payerType,
    });

    if (payerType === "customer" && order.user_id) {
      await notify({
        eventKey: "ORDER_PAYMENT_COMPLETED",
        actorUserId: null,
        recipientUserIds: [order.user_id],
        context: paymentContext,
        entityType: "order",
        entityId: order._id,
        franchiseId: order.franchise_id,
        metadata: paymentMetadata,
        dedupeKeyPrefix: `order.payment.completed:${payment._id}`,
      });
    }

    const stakeholderRecipients = excludeUserId(
      await resolveOrderRecipients(order),
      payerUserId
    );
    if (stakeholderRecipients.length) {
      await notify({
        eventKey: "ORDER_PAYMENT_RECEIVED",
        actorUserId: null,
        recipientUserIds: stakeholderRecipients,
        context: paymentContext,
        entityType: "order",
        entityId: order._id,
        franchiseId: order.franchise_id,
        metadata: paymentMetadata,
        dedupeKeyPrefix: `order.payment.received:${payment._id}`,
      });
    }

    void safeNotifyBackofficeOrderPayment({ order, payment, actorUserId });
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
    // QUOTE_CREATED: customer, assigned employee, franchise admin(s).
    // Partner only after admin confirm (status pending+), e.g. admin create with partner.
    const recipients = await resolveQuoteRecipients(quote, {
      includePartner: shouldIncludePartnerInQuoteNotify({
        newStatus: quote?.status,
        quote,
      }),
    });
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
      dedupeKeyPrefix: `quote.created:${quote._id}`,
    });
    void safeNotifyBackofficeQuoteCreated({ quote, actorUserId });
  });
};

const safeNotifyQuoteStatusChanged = async ({
  quote,
  previousStatus,
  newStatus,
  actorUserId,
}) => {
  await runSafe("quote.status_changed", async () => {
    const prev = normalizeQuoteStatus(previousStatus, quote) || previousStatus;
    const next = normalizeQuoteStatus(newStatus, quote) || newStatus;
    if (!next || String(next) === String(prev)) return;

    const recipients = await resolveQuoteRecipients(quote, {
      includePartner: shouldIncludePartnerInQuoteNotify({
        previousStatus: prev,
        newStatus: next,
        quote,
      }),
    });
    await notify({
      eventKey: "QUOTE_STATUS_CHANGED",
      actorUserId,
      recipientUserIds: recipients,
      context: { quote, previousStatus: prev, newStatus: next },
      entityType: "quote",
      entityId: quote._id,
      franchiseId: quote.franchise_id,
      metadata: {
        quote_id: quote._id,
        quote_sequence_id: quote.quote_sequence_id,
        previousStatus: prev,
        newStatus: next,
      },
      dedupeKeyPrefix: `quote.status:${quote._id}:${next}`,
    });
    await safeNotifyBackofficeQuoteStatusChanged({
      quote,
      newStatus: next,
      actorUserId,
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
      dedupeKeyPrefix: `subscription.assigned:${subscription._id}`,
    });
    void safeNotifyBackofficeSubscriptionChanged({
      subscription,
      planName,
      changeLabel: "assigned",
      actorUserId,
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

const safeNotifyPartnerWorkStarted = async ({ order, actorUserId }) => {
  await runSafe("order.partner_work_started", async () => {
    if (!order?.user_id) return;

    await notify({
      eventKey: "PARTNER_WORK_STARTED",
      actorUserId,
      recipientUserIds: [order.user_id],
      context: { order },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order, {
        partner_work_status: "in-progress",
      }),
      dedupeKeyPrefix: `order.partner_work_started:${order._id}`,
    });
  });
};

const safeNotifyPartnerWorkCompleted = async ({ order, actorUserId }) => {
  await runSafe("order.partner_work_completed", async () => {
    if (!order?.user_id) return;

    await notify({
      eventKey: "PARTNER_WORK_COMPLETED",
      actorUserId,
      recipientUserIds: [order.user_id],
      context: { order },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order, {
        partner_work_status: "completed",
        order_status: order.order_status,
      }),
      dedupeKeyPrefix: `order.partner_work_completed:${order._id}`,
    });
  });
};

const safeNotifyQuoteAssigned = async ({ quote, actorUserId }) => {
  await runSafe("quote.assigned", async () => {
    if (!quote?.partner_id) return;

    await notify({
      eventKey: "QUOTE_ASSIGNED",
      actorUserId,
      recipientUserIds: [quote.partner_id],
      context: { quote },
      entityType: "quote",
      entityId: quote._id,
      franchiseId: quote.franchise_id,
      metadata: {
        quote_id: quote._id,
        quote_sequence_id: quote.quote_sequence_id,
        partner_id: quote.partner_id,
      },
      dedupeKeyPrefix: `quote.assigned:${quote._id}`,
    });
  });
};

const safeNotifyPartnerPostReviewed = async ({
  post,
  partnerUserId,
  reviewStatus,
  rejectionReason = "",
  actorUserId,
}) => {
  await runSafe("partner.post_reviewed", async () => {
    const isApproved = String(reviewStatus || "").toLowerCase() === "approved";
    const eventKey = isApproved ? "PARTNER_POST_APPROVED" : "PARTNER_POST_REJECTED";
    const postDescription = truncatePostDescription(post?.description);

    await notify({
      eventKey,
      actorUserId,
      recipientUserIds: [partnerUserId],
      context: {
        post,
        postDescription,
        rejectionReason: String(rejectionReason || "").trim(),
      },
      entityType: "partner_post",
      entityId: post?._id,
      franchiseId: post?.franchise_id || null,
      metadata: {
        post_id: post?._id || null,
        status: isApproved ? "published" : "rejected",
        rejection_reason: isApproved ? "" : String(rejectionReason || "").trim(),
      },
      dedupeKeyPrefix: `partner.post.reviewed:${post?._id}:${post?.updated_at ? new Date(post.updated_at).toISOString() : Date.now()}`,
    });
  });
};

const safeNotifyPartnerPostModerated = async ({
  post,
  partnerUserId,
  moderationStatus,
  actorUserId,
}) => {
  await runSafe("partner.post_moderated", async () => {
    const status = String(moderationStatus || "").toLowerCase();
    if (status !== "hidden" && status !== "removed") return;

    const eventKey = status === "hidden" ? "PARTNER_POST_HIDDEN" : "PARTNER_POST_REMOVED";
    const postDescription = truncatePostDescription(post?.description);

    await notify({
      eventKey,
      actorUserId,
      recipientUserIds: [partnerUserId],
      context: { post, postDescription },
      entityType: "partner_post",
      entityId: post?._id,
      franchiseId: post?.franchise_id || null,
      metadata: {
        post_id: post?._id || null,
        status,
      },
      dedupeKeyPrefix: `partner.post.moderated:${post?._id}:${status}:${post?.updated_at ? new Date(post.updated_at).toISOString() : Date.now()}`,
    });
  });
};

const safeNotifyPartnerPostLiked = async ({
  post,
  partnerUserId,
  customerName,
  likeId,
  actorUserId,
}) => {
  await runSafe("partner.post_liked", async () => {
    if (!partnerUserId) return;
    if (String(partnerUserId) === String(actorUserId)) return;

    const postDescription = truncatePostDescription(post?.description);

    await notify({
      eventKey: "PARTNER_POST_LIKED",
      actorUserId,
      recipientUserIds: [partnerUserId],
      context: { post, postDescription, customerName },
      entityType: "partner_post",
      entityId: post?._id,
      franchiseId: post?.franchise_id || null,
      metadata: {
        post_id: post?._id || null,
        like_id: likeId || null,
        customer_name: customerName || "",
      },
      dedupeKeyPrefix: likeId
        ? `partner.post.liked:${likeId}`
        : `partner.post.liked:${post?._id}:${actorUserId}`,
    });
  });
};

const safeNotifyPartnerVerificationUpdated = async ({
  partnerUserId,
  verificationStatus,
  actorUserId,
}) => {
  await runSafe("partner.verification_updated", async () => {
    const status = Number(verificationStatus);
    if (status === 2) {
      await notify({
        eventKey: "PARTNER_VERIFICATION_APPROVED",
        actorUserId,
        recipientUserIds: [partnerUserId],
        context: { verificationStatus: status },
        entityType: "user",
        entityId: partnerUserId,
        metadata: { verification_status: status },
        dedupeKeyPrefix: `partner.verification:${partnerUserId}:approved`,
      });
      return;
    }

    if (status === 3) {
      await notify({
        eventKey: "PARTNER_VERIFICATION_REJECTED",
        actorUserId,
        recipientUserIds: [partnerUserId],
        context: { verificationStatus: status },
        entityType: "user",
        entityId: partnerUserId,
        metadata: { verification_status: status },
        dedupeKeyPrefix: `partner.verification:${partnerUserId}:rejected`,
      });
    }
  });
};

const safeNotifyOrderAdditionalChargeUpdated = async ({
  order,
  charge,
  actorUserId,
}) => {
  await runSafe("order.additional_charge_updated", async () => {
    const recipients = await resolveOrderRecipients(order);
    const label = charge?.label ? String(charge.label).trim() : "";
    await notify({
      eventKey: "ORDER_ADDITIONAL_CHARGE_UPDATED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        order,
        label,
        totalAmount: charge?.total_amount,
        orderUniqueId: order?.unique_id,
      },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order, {
        charge_id: charge?._id,
        total_amount: charge?.total_amount,
        label,
      }),
      dedupeKeyPrefix: charge?._id ? `order.charge_updated:${charge._id}` : null,
    });
  });
};

const safeNotifyOrderAdditionalChargeRemoved = async ({
  order,
  chargeId,
  label,
  actorUserId,
}) => {
  await runSafe("order.additional_charge_removed", async () => {
    const recipients = await resolveOrderRecipients(order);
    await notify({
      eventKey: "ORDER_ADDITIONAL_CHARGE_REMOVED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        order,
        label: label || "",
        orderUniqueId: order?.unique_id,
      },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order, {
        charge_id: chargeId || null,
        label: label || "",
      }),
      dedupeKeyPrefix: chargeId ? `order.charge_removed:${chargeId}` : null,
    });
  });
};

const safeNotifyOrderPaymentFailed = async ({ order, payment, actorUserId }) => {
  await runSafe("order.payment_failed", async () => {
    if (!order?.user_id) return;

    await notify({
      eventKey: "ORDER_PAYMENT_FAILED",
      actorUserId,
      recipientUserIds: [order.user_id],
      context: {
        order,
        orderUniqueId: order?.unique_id,
        amount: payment?.amount,
      },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order, {
        payment_id: payment?._id || null,
        amount: payment?.amount,
      }),
      dedupeKeyPrefix: payment?._id ? `order.payment_failed:${payment._id}` : null,
    });
  });
};

const safeNotifyOrderRefundProcessed = async ({ order, amount, actorUserId }) => {
  await runSafe("order.refund_processed", async () => {
    const recipients = await resolveOrderRecipients(order);
    await notify({
      eventKey: "ORDER_REFUND_PROCESSED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        order,
        amount,
        orderUniqueId: order?.unique_id,
      },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order, { amount }),
      dedupeKeyPrefix: `order.refund:${order._id}:${formatAmount(amount)}`,
    });
    void safeNotifyBackofficeOrderStatusChanged({
      order,
      newStatus: "refunded",
      actorUserId,
    });
  });
};

const safeNotifyDisputeStatusChanged = async ({
  dispute,
  order,
  previousStatus,
  newStatus,
  actorUserId,
}) => {
  await runSafe("dispute.status_changed", async () => {
    if (!newStatus || newStatus === previousStatus) return;
    if (!dispute?.user_id) return;

    await notify({
      eventKey: "DISPUTE_STATUS_CHANGED",
      actorUserId,
      recipientUserIds: [dispute.user_id],
      context: { dispute, order, previousStatus, newStatus },
      entityType: "dispute",
      entityId: dispute._id,
      franchiseId: dispute.franchise_id,
      metadata: {
        order_id: order?._id || null,
        order_unique_id: order?.unique_id || "",
        dispute_id: dispute._id,
        dispute_unique_id: dispute.unique_id || "",
        previousStatus,
        newStatus,
      },
      dedupeKeyPrefix: `dispute.status:${dispute._id}:${newStatus}`,
    });
  });
};

const safeNotifyOrderReviewReceived = async ({ order, partnerUserId, actorUserId, rating }) => {
  await runSafe("order.review_received", async () => {
    if (!partnerUserId) return;

    await notify({
      eventKey: "ORDER_REVIEW_RECEIVED",
      actorUserId,
      recipientUserIds: [partnerUserId],
      context: { order },
      entityType: "order",
      entityId: order?._id,
      franchiseId: order?.franchise_id,
      metadata: buildOrderMetadata(order),
      dedupeKeyPrefix: order?._id ? `order.review:${order._id}:${partnerUserId}` : null,
    });

    void safeNotifyBackofficeOrderReviewReceived({
      order,
      partnerUserId,
      rating,
      actorUserId,
    });
  });
};

const safeNotifyOrderInvoiceDownloaded = async ({ order }) => {
  await runSafe("order.invoice_downloaded", async () => {
    if (!order?._id) return;

    const recipientUserIds = new Set();
    addRecipientId(recipientUserIds, order.user_id);
    const partnerUserIds = await collectOrderPartnerUserIds(order);
    partnerUserIds.forEach((id) => recipientUserIds.add(String(id)));
    if (!recipientUserIds.size) return;

    await notify({
      eventKey: "ORDER_INVOICE_DOWNLOADED",
      recipientUserIds: [...recipientUserIds],
      context: { order },
      entityType: "order",
      entityId: order._id,
      franchiseId: order.franchise_id,
      metadata: buildOrderMetadata(order),
      dedupeKeyPrefix: `order.invoice.downloaded:${order._id}`,
    });
  });
};

const safeNotifySubscriptionPlanChanged = async ({
  subscription,
  planName,
  paymentCompleted = false,
  actorUserId,
}) => {
  await runSafe("subscription.plan_changed", async () => {
    const partnerId = subscription?.partner_id;
    if (!partnerId) return;

    const eventKey = paymentCompleted
      ? "SUBSCRIPTION_PAYMENT_COMPLETED"
      : "SUBSCRIPTION_PLAN_CHANGED";

    await notify({
      eventKey,
      actorUserId,
      recipientUserIds: [partnerId],
      context: { planName, paymentCompleted },
      entityType: "subscription",
      entityId: subscription._id,
      franchiseId: subscription.franchise_id || null,
      metadata: {
        subscription_id: subscription._id,
        plan_name: planName,
        payment_completed: paymentCompleted,
      },
      dedupeKeyPrefix: paymentCompleted
        ? `subscription.payment:${subscription._id}:${planName}`
        : `subscription.plan:${subscription._id}:${planName}`,
    });
    void safeNotifyBackofficeSubscriptionChanged({
      subscription,
      planName,
      changeLabel: paymentCompleted ? "paid and updated" : "changed",
      actorUserId,
    });
  });
};

const safeNotifyAppointmentScheduled = async ({ appointment, actorUserId }) => {
  await runSafe("appointment.scheduled", async () => {
    const recipients = [appointment?.user_id, appointment?.partner_id].filter(Boolean);
    if (!recipients.length) return;

    await notify({
      eventKey: "APPOINTMENT_SCHEDULED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        orderUniqueId: appointment?.order_unique_id,
        appointment,
      },
      entityType: "appointment",
      entityId: appointment._id,
      franchiseId: appointment.franchise_id,
      metadata: {
        appointment_id: appointment._id,
        order_id: appointment.order_id,
        order_unique_id: appointment.order_unique_id,
      },
      dedupeKeyPrefix: `appointment.scheduled:${appointment._id}`,
    });
  });
};

const safeNotifyAppointmentStatusChanged = async ({
  appointment,
  previousStatus,
  newStatus,
  actorUserId,
}) => {
  await runSafe("appointment.status_changed", async () => {
    if (!newStatus || newStatus === previousStatus) return;

    const recipients = [appointment?.user_id, appointment?.partner_id].filter(Boolean);
    if (!recipients.length) return;

    await notify({
      eventKey: "APPOINTMENT_STATUS_CHANGED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        appointment,
        orderUniqueId: appointment?.order_unique_id,
        newStatus,
      },
      entityType: "appointment",
      entityId: appointment._id,
      franchiseId: appointment.franchise_id,
      metadata: {
        appointment_id: appointment._id,
        order_id: appointment.order_id,
        order_unique_id: appointment.order_unique_id,
        previousStatus,
        newStatus,
      },
      dedupeKeyPrefix: `appointment.status:${appointment._id}:${newStatus}`,
    });
  });
};

const safeNotifyTicketStatusChanged = async ({ ticket, statusLabel, actorUserId }) => {
  await runSafe("ticket.status_changed", async () => {
    if (!ticket?.created_by_id) return;

    await notify({
      eventKey: "TICKET_STATUS_CHANGED",
      actorUserId,
      recipientUserIds: [ticket.created_by_id],
      context: {
        ticketId: ticket.unique_id,
        statusLabel,
      },
      entityType: "ticket",
      entityId: ticket._id,
      franchiseId: null,
      metadata: {
        ticket_id: ticket._id,
        ticket_unique_id: ticket.unique_id,
        status: ticket.status,
        status_label: statusLabel,
      },
      dedupeKeyPrefix: `ticket.status:${ticket._id}:${statusLabel}`,
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
  safeNotifyPartnerWorkStarted,
  safeNotifyPartnerWorkCompleted,
  safeNotifyQuoteAssigned,
  safeNotifyPartnerPostReviewed,
  safeNotifyPartnerPostModerated,
  safeNotifyPartnerPostLiked,
  safeNotifyPartnerVerificationUpdated,
  safeNotifyOrderAdditionalChargeUpdated,
  safeNotifyOrderAdditionalChargeRemoved,
  safeNotifyOrderPaymentFailed,
  safeNotifyOrderRefundProcessed,
  safeNotifyDisputeStatusChanged,
  safeNotifyOrderReviewReceived,
  safeNotifyOrderInvoiceDownloaded,
  safeNotifySubscriptionPlanChanged,
  safeNotifyAppointmentScheduled,
  safeNotifyAppointmentStatusChanged,
  safeNotifyTicketStatusChanged,
};
