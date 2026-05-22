const { shapeFinancialOverviewRecord } = require("../services/order_financial_payments_service");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const row = {
  _id: "6a0fefdbeac1df23f48d2273",
  unique_id: "O1001",
  franchise_id: "6a02fc798aa7289434018c65",
  user_id: "6a0aaf401956a62fb46093b3",
  partner_id: "6a0c06dde0b83d58e005c8c5",
  _user_name: "Akhila",
  _partner_name: "south franchise partner",
  _service_name: "Legal Documentation Service",
  service_date: new Date("2000-01-01T11:23:00.000Z"),
  order_date: "2026-05-22",
  created_at: new Date("2026-05-22T05:55:39.173Z"),
  total_price: 1375,
  commission_percent: 25,
  commission_amount: 250,
  tax_percent: 10,
  tax_amount: 125,
  sub_total: 1250,
  customer_net_paid: 1375,
  customer_paid_amount: 1375,
  customer_due_amount: 0,
  partner_paid_amount: 1000,
  partner_due_amount: 375,
  partner_payment_status: "partially_paid",
  user_payment_status: "paid",
  additional_charges_subtotal: 0,
  _line_partner_earning: 1000,
  order_status: "in-progress",
};

const record = shapeFinancialOverviewRecord(row, 1);

assert(record.pending_to_partner === 0, "pending_to_partner cleared when entitlement met");
assert(record.partner_payment_status === "paid", "partner_payment_status paid");
assert(record.commission_amount === 250, "commission_amount");
assert(record.tax_amount === 125, "tax_amount");
assert(record.service_date === "2026-05-22", "service_date falls back to order_date");

console.log("verify-financial-order-payment-shape: all checks passed");
