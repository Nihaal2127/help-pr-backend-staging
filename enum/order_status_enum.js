const ORDER_STATUS_IN_PROGRESS = 'in-progress';
const ORDER_STATUS_COMPLETED = 'completed';
const ORDER_STATUS_CANCELLED = 'cancelled';
const ORDER_STATUS_REFUNDED = 'refunded';

const ORDER_STATUSES = [
  ORDER_STATUS_IN_PROGRESS,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_REFUNDED,
];

const DEFAULT_ORDER_STATUS = ORDER_STATUS_IN_PROGRESS;

/** Legacy numeric values stored before string migration */
const LEGACY_NUMERIC_TO_STATUS = {
  1: ORDER_STATUS_IN_PROGRESS,
  2: ORDER_STATUS_IN_PROGRESS,
  3: ORDER_STATUS_COMPLETED,
  4: ORDER_STATUS_CANCELLED,
};

/** Numeric DB values that map to each canonical status (for counts / list filters). */
const LEGACY_NUMERIC_BY_STATUS = Object.entries(LEGACY_NUMERIC_TO_STATUS).reduce(
  (acc, [num, status]) => {
    if (!acc[status]) acc[status] = [];
    acc[status].push(Number(num));
    return acc;
  },
  {},
);

const STATUS_ALIASES = {
  pending: ORDER_STATUS_IN_PROGRESS,
  'in progress': ORDER_STATUS_IN_PROGRESS,
  inprogress: ORDER_STATUS_IN_PROGRESS,
  complete: ORDER_STATUS_COMPLETED,
  canceled: ORDER_STATUS_CANCELLED,
  cancel: ORDER_STATUS_CANCELLED,
  refund: ORDER_STATUS_REFUNDED,
};

const normalizeOrderStatus = (value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (ORDER_STATUSES.includes(raw)) return raw;
  if (STATUS_ALIASES[raw]) return STATUS_ALIASES[raw];
  const num = parseInt(raw, 10);
  if (!Number.isNaN(num) && LEGACY_NUMERIC_TO_STATUS[num]) {
    return LEGACY_NUMERIC_TO_STATUS[num];
  }
  return null;
};

const isValidOrderStatus = (value) => normalizeOrderStatus(value) !== null;

/**
 * All `order_status` values that belong to a bucket (canonical string + legacy numbers).
 * Used so getCount and getAll stay aligned before/after ORDER_STATUS_MIGRATION.
 */
const buildOrderStatusMatchValues = (value) => {
  const normalized = normalizeOrderStatus(value);
  if (!normalized) return null;
  const legacyNums = LEGACY_NUMERIC_BY_STATUS[normalized] || [];
  return [normalized, ...legacyNums];
};

/** Mongo filter fragment: { order_status: … } matching one dashboard bucket. */
const buildOrderStatusQueryFilter = (value) => {
  const values = buildOrderStatusMatchValues(value);
  if (!values) return null;
  if (values.length === 1) {
    return { order_status: values[0] };
  }
  return { order_status: { $in: values } };
};

/** Customer rollup statuses that mean money was refunded (refund API does not always set order_status). */
const CUSTOMER_REFUND_PAYMENT_STATUSES = ['refund', 'partially_refund'];

const buildRefundedPaymentRollupFilter = () => ({
  $or: [
    { user_payment_status: { $in: CUSTOMER_REFUND_PAYMENT_STATUSES } },
    { payment_status: { $in: CUSTOMER_REFUND_PAYMENT_STATUSES } },
  ],
});

/** Orders in the Refunded tab: explicit order_status or customer payment rollup shows refund. */
const buildRefundedOrderQueryFilter = () => {
  const statusPart = buildOrderStatusQueryFilter(ORDER_STATUS_REFUNDED);
  return {
    $or: [statusPart, buildRefundedPaymentRollupFilter()],
  };
};

/** Exclude refunded-tab orders from in-progress / completed / cancelled buckets. */
const buildExcludeRefundedPaymentOrdersFilter = () => {
  const refundedStatusValues =
    buildOrderStatusMatchValues(ORDER_STATUS_REFUNDED) || [ORDER_STATUS_REFUNDED];
  return {
    order_status: { $nin: refundedStatusValues },
    user_payment_status: { $nin: CUSTOMER_REFUND_PAYMENT_STATUSES },
    payment_status: { $nin: CUSTOMER_REFUND_PAYMENT_STATUSES },
  };
};

/**
 * Order-management getCount + getAll?order_status= — mutually exclusive buckets.
 * Refunded includes payment rollups; other buckets exclude refund rollups.
 */
const buildOrderManagementStatusQueryFilter = (value) => {
  const normalized = normalizeOrderStatus(value);
  if (!normalized) return null;

  if (normalized === ORDER_STATUS_REFUNDED) {
    return buildRefundedOrderQueryFilter();
  }

  const base = buildOrderStatusQueryFilter(normalized);
  if (!base) return null;

  if (
    normalized === ORDER_STATUS_IN_PROGRESS ||
    normalized === ORDER_STATUS_COMPLETED ||
    normalized === ORDER_STATUS_CANCELLED
  ) {
    return { $and: [base, buildExcludeRefundedPaymentOrdersFilter()] };
  }

  return base;
};

const getOrderStatusLabel = (status) => {
  const normalized = normalizeOrderStatus(status);
  if (!normalized) return '';
  return normalized
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
};

const buildOrderStatusInfo = () =>
  ORDER_STATUSES.map((status) => ({
    status,
    updated_at: status === DEFAULT_ORDER_STATUS ? new Date() : null,
  }));

const touchOrderStatusInfo = (order, status) => {
  const normalized = normalizeOrderStatus(status);
  if (!normalized || !Array.isArray(order.order_status_info)) return;
  const entry = order.order_status_info.find((row) => row.status === normalized);
  if (entry) {
    entry.updated_at = new Date();
  }
};

/** Cancelled/refunded orders keep payment history but owe no further customer/partner amounts. */
const isOrderStatusWithNoPendingAmounts = (value) => {
  const normalized = normalizeOrderStatus(value);
  return (
    normalized === ORDER_STATUS_CANCELLED || normalized === ORDER_STATUS_REFUNDED
  );
};

const TERMINAL_ORDER_STATUSES_NO_PENDING = [
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_REFUNDED,
];

/** All DB `order_status` values (canonical + legacy) with no customer/partner pending. */
const buildTerminalOrderStatusMatchValues = () => {
  const values = [
    ...(buildOrderStatusMatchValues(ORDER_STATUS_CANCELLED) || []),
    ...(buildOrderStatusMatchValues(ORDER_STATUS_REFUNDED) || []),
  ];
  return [...new Set(values)];
};

/** Payment rows unchanged; only outstanding customer/partner due is cleared. */
const clearPendingAmountsForTerminalOrder = (order) => {
  if (!isOrderStatusWithNoPendingAmounts(order?.order_status)) return;
  order.customer_due_amount = 0;
  order.partner_due_amount = 0;
};

/** @deprecated use normalizeOrderStatus / getOrderStatusLabel */
const getOrderStatus = (key) => getOrderStatusLabel(key);

/** @deprecated use normalizeOrderStatus */
const getOrderStatusKey = (value) => normalizeOrderStatus(value);

module.exports = {
  ORDER_STATUS_IN_PROGRESS,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_REFUNDED,
  ORDER_STATUSES,
  DEFAULT_ORDER_STATUS,
  normalizeOrderStatus,
  isValidOrderStatus,
  buildOrderStatusMatchValues,
  buildOrderStatusQueryFilter,
  CUSTOMER_REFUND_PAYMENT_STATUSES,
  buildRefundedOrderQueryFilter,
  buildExcludeRefundedPaymentOrdersFilter,
  buildOrderManagementStatusQueryFilter,
  getOrderStatusLabel,
  buildOrderStatusInfo,
  touchOrderStatusInfo,
  isOrderStatusWithNoPendingAmounts,
  clearPendingAmountsForTerminalOrder,
  buildTerminalOrderStatusMatchValues,
  TERMINAL_ORDER_STATUSES_NO_PENDING,
  getOrderStatus,
  getOrderStatusKey,
};
