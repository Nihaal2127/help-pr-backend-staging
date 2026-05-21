const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatMoney = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) return '0.00';
  return num.toFixed(2);
};

const formatDate = (value) => {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const buildServiceRows = (serviceItems) => {
  if (!Array.isArray(serviceItems) || serviceItems.length === 0) {
    return '<tr><td colspan="4">No line items</td></tr>';
  }
  return serviceItems
    .map((item) => {
      const name = item.service_info?.name || item.service_info?.service_id || 'Service';
      const partner = item.partner_info?.name || '—';
      const price = formatMoney(item.total_price ?? item.service_price ?? 0);
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(partner)}</td>
        <td>${escapeHtml(item.service_status || '—')}</td>
        <td style="text-align:right">₹ ${price}</td>
      </tr>`;
    })
    .join('');
};

const buildChargeRows = (charges) => {
  if (!Array.isArray(charges) || charges.length === 0) {
    return '';
  }
  return charges
    .map(
      (c) => `<tr>
        <td colspan="3">${escapeHtml(c.label || c.charge_type || 'Additional charge')}</td>
        <td style="text-align:right">₹ ${formatMoney(c.total_amount ?? c.amount)}</td>
      </tr>`
    )
    .join('');
};

const buildPaymentRows = (payments) => {
  const customerPayments = (payments || []).filter((p) => p.payer_type === 'customer');
  if (customerPayments.length === 0) {
    return '<tr><td colspan="4">No payments recorded</td></tr>';
  }
  return customerPayments
    .map(
      (p) => `<tr>
        <td>${formatDate(p.paid_at || p.created_at)}</td>
        <td>${escapeHtml(p.payment_method || '—')}</td>
        <td>${escapeHtml(p.status || '—')}</td>
        <td style="text-align:right">₹ ${formatMoney(p.amount)}</td>
      </tr>`
    )
    .join('');
};

/**
 * Build a printable HTML invoice from a shaped order detail record (loadOrderDetailLean).
 */
const buildOrderInvoiceHtml = (record) => {
  const orderId = record.unique_id || record._id;
  const customerName = record.user_info?.name || '—';
  const customerEmail = record.user_info?.email || '—';
  const customerPhone = record.user_info?.phone_number || '—';
  const franchiseName = record.franchise_info?.name || '—';
  const address =
    record.address_info?.address ||
    record.address ||
    '—';
  const category = record.category_info?.name || '—';
  const service = record.service_info?.name || '—';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Invoice ${escapeHtml(orderId)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    .meta { margin-bottom: 20px; font-size: 14px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 20px; font-size: 14px; }
    th, td { border: 1px solid #ccc; padding: 8px; }
    th { background: #f5f5f5; text-align: left; }
    .totals td { border: none; padding: 4px 8px; }
    .totals tr td:last-child { text-align: right; font-weight: bold; }
    .section-title { margin: 18px 0 6px; font-size: 15px; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Order Invoice</h1>
  <div class="meta">
    <div><strong>Order ID:</strong> ${escapeHtml(orderId)}</div>
    <div><strong>Order date:</strong> ${formatDate(record.order_date || record.created_at)}</div>
    <div><strong>Status:</strong> ${escapeHtml(record.order_status || '—')}</div>
    <div><strong>Payment status:</strong> ${escapeHtml(record.payment_status || '—')}</div>
    <div><strong>Franchise:</strong> ${escapeHtml(franchiseName)}</div>
  </div>

  <div class="section-title">Bill to</div>
  <div class="meta">
    <div>${escapeHtml(customerName)}</div>
    <div>${escapeHtml(customerEmail)}</div>
    <div>${escapeHtml(customerPhone)}</div>
    <div>${escapeHtml(address)}</div>
  </div>

  <div class="section-title">Service</div>
  <div class="meta">
    <div><strong>Category:</strong> ${escapeHtml(category)}</div>
    <div><strong>Service:</strong> ${escapeHtml(service)}</div>
  </div>

  <div class="section-title">Line items</div>
  <table>
    <thead>
      <tr><th>Service</th><th>Partner</th><th>Status</th><th>Amount</th></tr>
    </thead>
    <tbody>
      ${buildServiceRows(record.service_items)}
      ${buildChargeRows(record.additional_charges)}
    </tbody>
  </table>

  <table class="totals">
    <tr><td>Subtotal</td><td>₹ ${formatMoney(record.sub_total)}</td></tr>
    <tr><td>Tax (${formatMoney(record.tax_percent)}%)</td><td>₹ ${formatMoney(record.tax_amount ?? record.tax)}</td></tr>
    <tr><td>Discount</td><td>₹ ${formatMoney(record.discount_amount ?? 0)}</td></tr>
    <tr><td>Additional charges</td><td>₹ ${formatMoney(record.additional_charges_total)}</td></tr>
    <tr><td>Total</td><td>₹ ${formatMoney(record.total_price)}</td></tr>
    <tr><td>Paid</td><td>₹ ${formatMoney(record.customer_net_paid)}</td></tr>
    <tr><td>Due</td><td>₹ ${formatMoney(record.customer_due_amount)}</td></tr>
  </table>

  <div class="section-title">Payments</div>
  <table>
    <thead>
      <tr><th>Date</th><th>Method</th><th>Status</th><th>Amount</th></tr>
    </thead>
    <tbody>
      ${buildPaymentRows(record.order_payments)}
    </tbody>
  </table>
</body>
</html>`;
};

module.exports = { buildOrderInvoiceHtml, escapeHtml };
