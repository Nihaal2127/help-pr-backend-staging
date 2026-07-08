const { notify } = require("./notification.service");
const {
  resolveSuperAdminStaffRecipients,
  resolveFranchiseBackofficeRecipients,
  resolveFranchiseIdFromUserId,
  loadFranchiseName,
  uniqueRecipientIds,
  resolveSuperAdminAndFranchiseRecipients,
} = require("../resolvers/backofficeRecipients");

const runSafe = async (label, fn) => {
  try {
    await fn();
  } catch (error) {
    console.error(`[notifications] ${label}:`, error.message || error);
  }
};

const notifyBackoffice = (params) => notify({ ...params, skipPush: true });

const franchiseSuffix = (franchiseName) =>
  franchiseName ? ` (${franchiseName})` : "";

const safeNotifyBackofficeCategoryRequested = async ({ category, actorUserId }) => {
  await runSafe("backoffice.category_requested", async () => {
    const franchiseId = await resolveFranchiseIdFromUserId(category?.requested_by);
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminStaffRecipients();
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey: "CATEGORY_REQUEST_SUBMITTED",
      actorUserId,
      recipientUserIds: recipients,
      context: { categoryName: category?.name || "", franchiseName },
      entityType: "category",
      entityId: category?._id,
      franchiseId,
      metadata: {
        category_id: category?._id,
        category_name: category?.name || "",
        requested_by: category?.requested_by || null,
      },
      dedupeKeyPrefix: `backoffice.category.requested:${category?._id}`,
    });
  });
};

const safeNotifyBackofficeServiceRequested = async ({ service, actorUserId }) => {
  await runSafe("backoffice.service_requested", async () => {
    const franchiseId = await resolveFranchiseIdFromUserId(service?.requested_by);
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminStaffRecipients();
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey: "SERVICE_REQUEST_SUBMITTED",
      actorUserId,
      recipientUserIds: recipients,
      context: { serviceName: service?.name || "", franchiseName },
      entityType: "service",
      entityId: service?._id,
      franchiseId,
      metadata: {
        service_id: service?._id,
        service_name: service?.name || "",
        requested_by: service?.requested_by || null,
      },
      dedupeKeyPrefix: `backoffice.service.requested:${service?._id}`,
    });
  });
};

const safeNotifyBackofficeCatalogReviewed = async ({
  entityType,
  entity,
  approvalStatus,
  actorUserId,
}) => {
  await runSafe("backoffice.catalog_reviewed", async () => {
    const status = String(approvalStatus || "").toLowerCase();
    if (!["approve", "rejected"].includes(status)) return;

    const franchiseId = await resolveFranchiseIdFromUserId(entity?.requested_by);
    const franchiseName = await loadFranchiseName(franchiseId);
    const franchiseUsers = await resolveFranchiseBackofficeRecipients(franchiseId);
    const recipientUserIds = uniqueRecipientIds([
      entity?.requested_by,
      ...franchiseUsers,
    ]);
    if (!recipientUserIds.length) return;

    const itemName = entity?.name || "";
    const itemLabel = entityType === "service" ? "Service" : "Category";

    await notifyBackoffice({
      eventKey: "CATALOG_REQUEST_REVIEWED",
      actorUserId,
      recipientUserIds,
      context: {
        itemLabel,
        itemName,
        approvalStatus: status,
        franchiseName,
      },
      entityType,
      entityId: entity?._id,
      franchiseId,
      metadata: {
        entity_type: entityType,
        entity_id: entity?._id,
        item_name: itemName,
        approval_status: status,
        rejection_reason: entity?.rejection_reason || "",
      },
      dedupeKeyPrefix: `backoffice.catalog.reviewed:${entityType}:${entity?._id}:${status}`,
    });
  });
};

const safeNotifyBackofficePartnerPending = async ({ partner, actorUserId }) => {
  await runSafe("backoffice.partner_pending", async () => {
    if (Number(partner?.verification_status) !== 1) return;

    const franchiseId = partner?.franchise_id || null;
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminAndFranchiseRecipients(franchiseId);
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey: "PARTNER_PENDING_VERIFICATION",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        partnerName: partner?.name || partner?.user_id || "",
        franchiseName,
      },
      entityType: "user",
      entityId: partner?._id,
      franchiseId,
      metadata: {
        partner_id: partner?._id,
        partner_user_id: partner?.user_id || "",
        verification_status: partner?.verification_status,
      },
      dedupeKeyPrefix: `backoffice.partner.pending:${partner?._id}`,
    });
  });
};

const safeNotifyBackofficeEmployeeAdded = async ({ employee, actorUserId }) => {
  await runSafe("backoffice.employee_added", async () => {
    const franchiseId = employee?.franchise_id || null;
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminStaffRecipients();
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey: "EMPLOYEE_ADDED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        employeeName: employee?.name || employee?.user_id || "",
        franchiseName,
      },
      entityType: "user",
      entityId: employee?._id,
      franchiseId,
      metadata: {
        employee_id: employee?._id,
        employee_user_id: employee?.user_id || "",
      },
      dedupeKeyPrefix: `backoffice.employee.added:${employee?._id}`,
    });
  });
};

const safeNotifyBackofficeExpenseCreated = async ({ expense, actorUserId }) => {
  await runSafe("backoffice.expense_created", async () => {
    const franchiseId = expense?.franchise_id || null;
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminStaffRecipients();
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey: "EXPENSE_CREATED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        expenseName: expense?.expense_name || "",
        amount: expense?.expense_amount,
        franchiseName,
      },
      entityType: "expense",
      entityId: expense?._id,
      franchiseId,
      metadata: {
        expense_id: expense?._id,
        expense_name: expense?.expense_name || "",
        expense_amount: expense?.expense_amount,
      },
      dedupeKeyPrefix: `backoffice.expense.created:${expense?._id}`,
    });
  });
};

const safeNotifyBackofficeQuoteCreated = async ({ quote, actorUserId }) => {
  await runSafe("backoffice.quote_created", async () => {
    const franchiseId = quote?.franchise_id || null;
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminStaffRecipients();
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey: "BACKOFFICE_QUOTE_CREATED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        quoteSequenceId: quote?.quote_sequence_id || "",
        franchiseName,
      },
      entityType: "quote",
      entityId: quote?._id,
      franchiseId,
      metadata: {
        quote_id: quote?._id,
        quote_sequence_id: quote?.quote_sequence_id || "",
      },
      dedupeKeyPrefix: `backoffice.quote.created:${quote?._id}`,
    });
  });
};

const safeNotifyBackofficeQuoteStatusChanged = async ({
  quote,
  newStatus,
  actorUserId,
}) => {
  await runSafe("backoffice.quote_status_changed", async () => {
    const status = String(newStatus || "").toLowerCase();
    if (!["accepted", "failed"].includes(status)) return;

    const franchiseId = quote?.franchise_id || null;
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminStaffRecipients();
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey: "BACKOFFICE_QUOTE_STATUS_CHANGED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        quoteSequenceId: quote?.quote_sequence_id || "",
        newStatus: status,
        franchiseName,
      },
      entityType: "quote",
      entityId: quote?._id,
      franchiseId,
      metadata: {
        quote_id: quote?._id,
        quote_sequence_id: quote?.quote_sequence_id || "",
        new_status: status,
      },
      dedupeKeyPrefix: `backoffice.quote.status:${quote?._id}:${status}`,
    });
  });
};

const safeNotifyBackofficeOrderCreated = async ({ order, actorUserId }) => {
  await runSafe("backoffice.order_created", async () => {
    const franchiseId = order?.franchise_id || null;
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminStaffRecipients();
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey: "BACKOFFICE_ORDER_CREATED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        orderUniqueId: order?.unique_id || "",
        franchiseName,
      },
      entityType: "order",
      entityId: order?._id,
      franchiseId,
      metadata: {
        order_id: order?._id,
        order_unique_id: order?.unique_id || "",
      },
      dedupeKeyPrefix: `backoffice.order.created:${order?._id}`,
    });
  });
};

const safeNotifyBackofficeOrderStatusChanged = async ({
  order,
  newStatus,
  actorUserId,
}) => {
  await runSafe("backoffice.order_status_changed", async () => {
    const status = String(newStatus || "").toLowerCase();
    if (!["completed", "cancelled", "refunded"].includes(status)) return;

    const franchiseId = order?.franchise_id || null;
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminStaffRecipients();
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey: "BACKOFFICE_ORDER_STATUS_CHANGED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        orderUniqueId: order?.unique_id || "",
        newStatus: status,
        franchiseName,
      },
      entityType: "order",
      entityId: order?._id,
      franchiseId,
      metadata: {
        order_id: order?._id,
        order_unique_id: order?.unique_id || "",
        new_status: status,
      },
      dedupeKeyPrefix: `backoffice.order.status:${order?._id}:${status}`,
    });
  });
};

const safeNotifyBackofficeOrderPayment = async ({ order, payment, actorUserId }) => {
  await runSafe("backoffice.order_payment", async () => {
    if (!payment || payment.status !== "completed") return;

    const payerType = String(payment.payer_type || "customer").toLowerCase();
    const eventKey =
      payerType === "partner"
        ? "BACKOFFICE_PARTNER_PAYMENT_RECEIVED"
        : "BACKOFFICE_CUSTOMER_PAYMENT_RECEIVED";

    const franchiseId = order?.franchise_id || null;
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminStaffRecipients();
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey,
      actorUserId,
      recipientUserIds: recipients,
      context: {
        orderUniqueId: order?.unique_id || "",
        amount: payment.amount,
        franchiseName,
      },
      entityType: "order",
      entityId: order?._id,
      franchiseId,
      metadata: {
        order_id: order?._id,
        order_unique_id: order?.unique_id || "",
        payment_id: payment._id,
        amount: payment.amount,
        payer_type: payerType,
      },
      dedupeKeyPrefix: `backoffice.order.payment:${eventKey}:${payment._id}`,
    });
  });
};

const safeNotifyBackofficeSubscriptionChanged = async ({
  subscription,
  planName,
  changeLabel,
  actorUserId,
}) => {
  await runSafe("backoffice.subscription_changed", async () => {
    const partnerId = subscription?.partner_id?._id || subscription?.partner_id;
    const franchiseId =
      subscription?.franchise_id ||
      (await resolveFranchiseIdFromUserId(partnerId));
    const franchiseName = await loadFranchiseName(franchiseId);
    const recipients = await resolveSuperAdminAndFranchiseRecipients(franchiseId);
    if (!recipients.length) return;

    await notifyBackoffice({
      eventKey: "BACKOFFICE_SUBSCRIPTION_CHANGED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        planName: planName || "",
        changeLabel: changeLabel || "updated",
        franchiseName,
      },
      entityType: "subscription",
      entityId: subscription?._id,
      franchiseId,
      metadata: {
        subscription_id: subscription?._id,
        plan_name: planName || "",
        change_label: changeLabel || "",
        partner_id: partnerId || null,
      },
      dedupeKeyPrefix: `backoffice.subscription.changed:${subscription?._id}:${planName}:${changeLabel}`,
    });
  });
};

const safeNotifyBackofficeChatMessage = async ({
  recipientUserIds,
  senderName,
  messagePreview,
  chatId,
  orderId,
  franchiseId,
  chatType,
  messageId,
  actorUserId,
}) => {
  await runSafe("backoffice.chat_message", async () => {
    const recipients = uniqueRecipientIds(recipientUserIds || []);
    if (!recipients.length) return;

    const franchiseName = await loadFranchiseName(franchiseId);

    await notifyBackoffice({
      eventKey: "BACKOFFICE_CHAT_MESSAGE_RECEIVED",
      actorUserId,
      recipientUserIds: recipients,
      context: {
        senderName: senderName || "New message",
        messagePreview: messagePreview || "",
        franchiseName,
        chatType: chatType || "",
      },
      entityType: "chat",
      entityId: chatId || null,
      franchiseId: franchiseId || null,
      metadata: {
        chat_id: chatId || null,
        order_id: orderId || null,
        chat_type: chatType || "",
        sender_name: senderName || "",
        message_id: messageId || null,
      },
      dedupeKeyPrefix: messageId ? `backoffice.chat.message:${messageId}` : null,
    });
  });
};

module.exports = {
  safeNotifyBackofficeCategoryRequested,
  safeNotifyBackofficeServiceRequested,
  safeNotifyBackofficeCatalogReviewed,
  safeNotifyBackofficePartnerPending,
  safeNotifyBackofficeEmployeeAdded,
  safeNotifyBackofficeExpenseCreated,
  safeNotifyBackofficeQuoteCreated,
  safeNotifyBackofficeQuoteStatusChanged,
  safeNotifyBackofficeOrderCreated,
  safeNotifyBackofficeOrderStatusChanged,
  safeNotifyBackofficeOrderPayment,
  safeNotifyBackofficeSubscriptionChanged,
  safeNotifyBackofficeChatMessage,
};
