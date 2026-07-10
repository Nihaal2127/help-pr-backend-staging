const { getOrderStatusLabel } = require("../../../../enum/order_status_enum");

const formatAmount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(2);
};

const NOTIFICATION_EVENTS = {
  ORDER_CREATED: {
    category: "order",
    title: () => "New order",
    body: (ctx) =>
      `Order #${ctx.order?.unique_id || ""} has been created.`,
  },
  ORDER_STATUS_CHANGED: {
    category: "order",
    title: () => "Order status update",
    body: (ctx) =>
      `Order #${ctx.order?.unique_id || ""} status changed to ${getOrderStatusLabel(ctx.newStatus || ctx.order?.order_status)}.`,
  },
  ORDER_CANCELLED: {
    category: "order",
    title: () => "Order cancelled",
    body: (ctx) =>
      `Order #${ctx.order?.unique_id || ""} has been cancelled.`,
  },
  ORDER_SERVICE_STATUS_CHANGED: {
    category: "order",
    title: () => "Service update",
    body: (ctx) =>
      `${ctx.serviceName || "Service"} status changed to ${getOrderStatusLabel(ctx.newStatus)} for order #${ctx.orderUniqueId || ""}.`,
  },
  ORDER_SERVICE_ASSIGNED: {
    category: "order",
    title: () => "New service assigned",
    body: (ctx) =>
      `You have a new service (${ctx.serviceName || "service"}) for order #${ctx.orderUniqueId || ""}.`,
  },
  ORDER_SERVICE_UNASSIGNED: {
    category: "order",
    title: () => "Service cancelled",
    body: (ctx) =>
      `Service for order #${ctx.orderUniqueId || ""} has been removed from your list.`,
  },
  ORDER_SERVICE_TIME_UPDATED: {
    category: "order",
    title: () => "Service time updated",
    body: (ctx) =>
      `Time updated for service (${ctx.serviceName || "service"}) of order #${ctx.orderUniqueId || ""}.`,
  },
  ORDER_SERVICE_CANCELLED: {
    category: "order",
    title: () => "Service cancelled",
    body: (ctx) =>
      ctx.serviceName
        ? `Your ${ctx.serviceName} for order #${ctx.orderUniqueId || ""} has been cancelled`
        : `A service for order #${ctx.orderUniqueId || ""} has been cancelled`,
  },
  ORDER_PAYMENT_COMPLETED: {
    category: "order",
    title: () => "Payment successful",
    body: (ctx) =>
      `Your payment of ${formatAmount(ctx.amount)} for order #${ctx.orderUniqueId || ""} was successful.`,
  },
  ORDER_PAYMENT_RECEIVED: {
    category: "order",
    title: () => "Payment received",
    body: (ctx) => {
      const payer = String(ctx.payerType || "customer").toLowerCase();
      if (payer === "partner") {
        return `Partner payment of ${formatAmount(ctx.amount)} received for order #${ctx.orderUniqueId || ""}.`;
      }
      return `Customer payment of ${formatAmount(ctx.amount)} received for order #${ctx.orderUniqueId || ""}.`;
    },
  },
  ORDER_ADDITIONAL_CHARGE_ADDED: {
    category: "order",
    title: () => "Additional charge added",
    body: (ctx) =>
      `Additional charge of ${formatAmount(ctx.amount)}${ctx.label ? ` (${ctx.label})` : ""} added to order #${ctx.orderUniqueId || ""}.`,
  },
  QUOTE_CREATED: {
    category: "quote",
    title: () => "New quote",
    body: (ctx) =>
      `Quote #${ctx.quote?.quote_sequence_id || ""} has been created.`,
  },
  QUOTE_STATUS_CHANGED: {
    category: "quote",
    title: () => "Quote status update",
    body: (ctx) =>
      `Quote #${ctx.quote?.quote_sequence_id || ""} status changed to ${ctx.newStatus || ctx.quote?.status}.`,
  },
  SUBSCRIPTION_ASSIGNED: {
    category: "subscription",
    title: () => "Subscription assigned",
    body: (ctx) =>
      `Subscription plan "${ctx.planName || "plan"}" has been assigned to you.`,
  },
  SUBSCRIPTION_STATUS_CHANGED: {
    category: "subscription",
    title: () => "Subscription update",
    body: (ctx) =>
      `Your subscription status is now ${ctx.newStatus || "updated"}.`,
  },
  WALLET_CREDIT: {
    category: "wallet",
    title: () => "Wallet credit",
    body: (ctx) =>
      `${formatAmount(ctx.amount)} credited to your wallet${ctx.description ? `: ${ctx.description}` : "."}`,
  },
  WALLET_DEBIT: {
    category: "wallet",
    title: () => "Wallet debit",
    body: (ctx) =>
      `${formatAmount(ctx.amount)} debited from your wallet${ctx.description ? `: ${ctx.description}` : "."}`,
  },
  DISPUTE_RAISED: {
    category: "chat",
    title: () => "New dispute",
    body: (ctx) =>
      `Customer raised dispute ${ctx.dispute?.unique_id || ""} for order #${ctx.order?.unique_id || ""}.`,
  },
  PARTNER_WORK_STARTED: {
    category: "order",
    title: () => "Partner on the way",
    body: (ctx) =>
      `Your partner has started work on order #${ctx.order?.unique_id || ""}.`,
  },
  PARTNER_WORK_COMPLETED: {
    category: "order",
    title: () => "Order completed",
    body: (ctx) =>
      `Order #${ctx.order?.unique_id || ""} has been completed by your partner.`,
  },
  QUOTE_ASSIGNED: {
    category: "quote",
    title: () => "New quote request",
    body: (ctx) =>
      `Quote #${ctx.quote?.quote_sequence_id || ""} has been assigned to you. Please review.`,
  },
  PARTNER_VERIFICATION_APPROVED: {
    category: "system",
    title: () => "Account verified",
    body: () =>
      "Your partner account has been verified. You can now accept jobs.",
  },
  PARTNER_VERIFICATION_REJECTED: {
    category: "system",
    title: () => "Verification update",
    body: () =>
      "Your partner verification was not approved. Please check your documents.",
  },
  ORDER_ADDITIONAL_CHARGE_UPDATED: {
    category: "order",
    title: () => "Additional charge updated",
    body: (ctx) =>
      ctx.label
        ? `Additional charge ${ctx.label} on order #${ctx.orderUniqueId || ""} was updated to ${formatAmount(ctx.totalAmount)}.`
        : `Additional charge on order #${ctx.orderUniqueId || ""} was updated to ${formatAmount(ctx.totalAmount)}.`,
  },
  ORDER_ADDITIONAL_CHARGE_REMOVED: {
    category: "order",
    title: () => "Additional charge removed",
    body: (ctx) =>
      ctx.label
        ? `Additional charge ${ctx.label} was removed from order #${ctx.orderUniqueId || ""}.`
        : `An additional charge was removed from order #${ctx.orderUniqueId || ""}.`,
  },
  ORDER_PAYMENT_FAILED: {
    category: "order",
    title: () => "Payment failed",
    body: (ctx) =>
      `Payment for order #${ctx.orderUniqueId || ""} could not be completed. Please try again.`,
  },
  ORDER_REFUND_PROCESSED: {
    category: "order",
    title: () => "Refund processed",
    body: (ctx) =>
      `A refund of ${formatAmount(ctx.amount)} has been processed for order #${ctx.orderUniqueId || ""}.`,
  },
  DISPUTE_STATUS_CHANGED: {
    category: "chat",
    title: () => "Dispute update",
    body: (ctx) =>
      `Your dispute ${ctx.dispute?.unique_id || ""} for order #${ctx.order?.unique_id || ""} is now ${ctx.newStatus || ""}.`,
  },
  ORDER_REVIEW_RECEIVED: {
    category: "order",
    title: () => "New review",
    body: (ctx) =>
      `You received a new review for order #${ctx.order?.unique_id || ""}.`,
  },
  SUBSCRIPTION_PLAN_CHANGED: {
    category: "subscription",
    title: () => "Subscription update",
    body: (ctx) =>
      `Your subscription plan has been changed to "${ctx.planName || "plan"}".`,
  },
  SUBSCRIPTION_PAYMENT_COMPLETED: {
    category: "subscription",
    title: () => "Subscription update",
    body: (ctx) =>
      `Your subscription payment was successful. Plan: "${ctx.planName || "plan"}".`,
  },
  APPOINTMENT_SCHEDULED: {
    category: "order",
    title: () => "Appointment scheduled",
    body: (ctx) =>
      `A service appointment has been scheduled for order #${ctx.orderUniqueId || ""}.`,
  },
  APPOINTMENT_STATUS_CHANGED: {
    category: "order",
    title: () => "Appointment update",
    body: (ctx) =>
      `Your appointment for order #${ctx.orderUniqueId || ""} is now ${ctx.newStatus || "updated"}.`,
  },
  TICKET_STATUS_CHANGED: {
    category: "ticket",
    title: () => "Ticket Update",
    body: (ctx) =>
      `Your ticket ${ctx.ticketId || ""} status changed to ${ctx.statusLabel || ""}.`,
  },
  SERVICE_REMINDER: {
    category: "reminder",
    title: () => "Service reminder",
    body: (ctx) =>
      `Your service for order #${ctx.orderUniqueId || ""} is scheduled soon.`,
  },
  QUOTE_ACTION_REMINDER: {
    category: "reminder",
    title: () => "Action required",
    body: (ctx) =>
      `Quote #${ctx.quoteSequenceId || ""} is waiting for your response.`,
  },
  SUBSCRIPTION_EXPIRING_REMINDER: {
    category: "reminder",
    title: () => "Subscription reminder",
    body: (ctx) =>
      ctx.planName
        ? `Your "${ctx.planName}" subscription expires soon. Renew to continue receiving jobs.`
        : "Your subscription plan expires soon. Renew to continue receiving jobs.",
  },
  CATEGORY_REQUEST_SUBMITTED: {
    category: "admin",
    title: () => "New category request",
    body: (ctx) =>
      `New category "${ctx.categoryName || "category"}" was requested${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  SERVICE_REQUEST_SUBMITTED: {
    category: "admin",
    title: () => "New service request",
    body: (ctx) =>
      `New service "${ctx.serviceName || "service"}" was requested${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  CATALOG_REQUEST_REVIEWED: {
    category: "admin",
    title: () => "Catalog request update",
    body: (ctx) =>
      `Your ${ctx.itemLabel || "catalog"} request "${ctx.itemName || ""}" was ${ctx.approvalStatus === "approve" ? "accepted" : "rejected"}${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  PARTNER_PENDING_VERIFICATION: {
    category: "admin",
    title: () => "Partner awaiting verification",
    body: (ctx) =>
      `Partner ${ctx.partnerName || ""} is waiting for verification${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  EMPLOYEE_ADDED: {
    category: "admin",
    title: () => "New employee added",
    body: (ctx) =>
      `Employee ${ctx.employeeName || ""} was added${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  EXPENSE_CREATED: {
    category: "admin",
    title: () => "New expense",
    body: (ctx) =>
      `Expense "${ctx.expenseName || ""}" of ${formatAmount(ctx.amount)} was recorded${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  BACKOFFICE_QUOTE_CREATED: {
    category: "admin",
    title: () => "New quote",
    body: (ctx) =>
      `Quote #${ctx.quoteSequenceId || ""} was created${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  BACKOFFICE_QUOTE_STATUS_CHANGED: {
    category: "admin",
    title: () => "Quote update",
    body: (ctx) =>
      `Quote #${ctx.quoteSequenceId || ""} was ${ctx.newStatus || "updated"} by partner${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  BACKOFFICE_ORDER_CREATED: {
    category: "admin",
    title: () => "New order",
    body: (ctx) =>
      `Order #${ctx.orderUniqueId || ""} was created${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  BACKOFFICE_ORDER_STATUS_CHANGED: {
    category: "admin",
    title: () => "Order update",
    body: (ctx) =>
      `Order #${ctx.orderUniqueId || ""} is now ${ctx.newStatus || "updated"}${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  BACKOFFICE_CUSTOMER_PAYMENT_RECEIVED: {
    category: "admin",
    title: () => "Customer payment received",
    body: (ctx) =>
      `Customer payment of ${formatAmount(ctx.amount)} received for order #${ctx.orderUniqueId || ""}${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  BACKOFFICE_PARTNER_PAYMENT_RECEIVED: {
    category: "admin",
    title: () => "Partner payment received",
    body: (ctx) =>
      `Partner payment of ${formatAmount(ctx.amount)} received for order #${ctx.orderUniqueId || ""}${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  BACKOFFICE_SUBSCRIPTION_CHANGED: {
    category: "admin",
    title: () => "Subscription update",
    body: (ctx) =>
      `Partner subscription was ${ctx.changeLabel || "updated"} to "${ctx.planName || "plan"}"${ctx.franchiseName ? ` (${ctx.franchiseName})` : ""}.`,
  },
  BACKOFFICE_CHAT_MESSAGE_RECEIVED: {
    category: "admin",
    title: (ctx) => ctx.senderName || "New message",
    body: (ctx) => ctx.messagePreview || "You have a new message.",
  },
};

module.exports = {
  NOTIFICATION_EVENTS,
  formatAmount,
};
