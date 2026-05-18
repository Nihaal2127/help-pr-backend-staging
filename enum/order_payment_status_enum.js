const ORDER_PAYMENT_STATUS_UNPAID = "unpaid";
const ORDER_PAYMENT_STATUS_PAID = "paid";
const ORDER_PAYMENT_STATUS_PARTIALLY_PAID = "partially_paid";
const ORDER_PAYMENT_STATUS_REFUND = "refund";
const ORDER_PAYMENT_STATUS_PARTIALLY_REFUND = "partially_refund";

const ORDER_PAYMENT_STATUSES = [
  ORDER_PAYMENT_STATUS_UNPAID,
  ORDER_PAYMENT_STATUS_PAID,
  ORDER_PAYMENT_STATUS_PARTIALLY_PAID,
  ORDER_PAYMENT_STATUS_REFUND,
  ORDER_PAYMENT_STATUS_PARTIALLY_REFUND,
];

const PAYMENT_STATUS_TOLERANCE = 0.01;

const roundMoney = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

const isValidOrderPaymentStatus = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return false;
  }
  return ORDER_PAYMENT_STATUSES.includes(String(value).trim().toLowerCase());
};

/**
 * Derive customer payment status from order total and customer payment rows.
 * @param {number} orderTotal - order.total_price (incl. additional charges)
 * @param {Array} payments - order_payment documents (customer rows only)
 */
const computeCustomerPaymentStatus = (orderTotal, payments = []) => {
  const totalDue = roundMoney(orderTotal);
  const rows = (payments || []).filter(
    (p) => String(p.payer_type).toLowerCase() === "customer"
  );

  if (rows.length === 0) {
    return {
      payment_status: ORDER_PAYMENT_STATUS_UNPAID,
      customer_paid_amount: 0,
      customer_refunded_amount: 0,
      customer_net_paid: 0,
      customer_due_amount: totalDue,
    };
  }

  let completedSum = 0;
  let refundedSum = 0;

  for (const row of rows) {
    const amt = roundMoney(row.amount);
    const st = String(row.status || "").toLowerCase();
    if (st === "completed") completedSum += amt;
    else if (st === "refunded") refundedSum += amt;
  }

  completedSum = roundMoney(completedSum);
  refundedSum = roundMoney(refundedSum);
  const netPaid = roundMoney(completedSum - refundedSum);
  const dueAmount = roundMoney(Math.max(0, totalDue - netPaid));

  let payment_status = ORDER_PAYMENT_STATUS_UNPAID;

  if (refundedSum > PAYMENT_STATUS_TOLERANCE) {
    const fullRefundOfPayments =
      completedSum > PAYMENT_STATUS_TOLERANCE &&
      refundedSum >= completedSum - PAYMENT_STATUS_TOLERANCE;
    const fullRefundOfOrder = refundedSum >= totalDue - PAYMENT_STATUS_TOLERANCE;

    if (fullRefundOfPayments || fullRefundOfOrder) {
      payment_status = ORDER_PAYMENT_STATUS_REFUND;
    } else {
      payment_status = ORDER_PAYMENT_STATUS_PARTIALLY_REFUND;
    }
  } else if (completedSum <= PAYMENT_STATUS_TOLERANCE) {
    payment_status = ORDER_PAYMENT_STATUS_UNPAID;
  } else if (netPaid >= totalDue - PAYMENT_STATUS_TOLERANCE) {
    payment_status = ORDER_PAYMENT_STATUS_PAID;
  } else if (netPaid > PAYMENT_STATUS_TOLERANCE) {
    payment_status = ORDER_PAYMENT_STATUS_PARTIALLY_PAID;
  }

  return {
    payment_status,
    customer_paid_amount: completedSum,
    customer_refunded_amount: refundedSum,
    customer_net_paid: netPaid,
    customer_due_amount: dueAmount,
  };
};

const getOrderPaymentStatusLabel = (status) => {
  const map = {
    unpaid: "Unpaid",
    paid: "Paid",
    partially_paid: "Partially paid",
    refund: "Refund",
    partially_refund: "Partially Refund",
  };
  return map[String(status || "").toLowerCase()] || status;
};

module.exports = {
  ORDER_PAYMENT_STATUS_UNPAID,
  ORDER_PAYMENT_STATUS_PAID,
  ORDER_PAYMENT_STATUS_PARTIALLY_PAID,
  ORDER_PAYMENT_STATUS_REFUND,
  ORDER_PAYMENT_STATUS_PARTIALLY_REFUND,
  ORDER_PAYMENT_STATUSES,
  PAYMENT_STATUS_TOLERANCE,
  isValidOrderPaymentStatus,
  computeCustomerPaymentStatus,
  getOrderPaymentStatusLabel,
};
