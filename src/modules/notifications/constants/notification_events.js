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
  ORDER_PAYMENT_RECEIVED: {
    category: "order",
    title: () => "Payment received",
    body: (ctx) =>
      `Payment of ${formatAmount(ctx.amount)} received for order #${ctx.orderUniqueId || ""}${ctx.payerType ? ` (${ctx.payerType})` : ""}.`,
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
};

module.exports = {
  NOTIFICATION_EVENTS,
  formatAmount,
};
