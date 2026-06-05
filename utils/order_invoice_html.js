const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatMoney = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) return '0.00';
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

const formatAddressLine = (record) => {
  const info = record.address_info;
  if (info && typeof info === 'object') {
    const parts = [
      info.address,
      info.landmark,
      info.area,
      info.city,
      info.state,
      info.pincode,
    ].filter((part) => part != null && String(part).trim() !== '');
    if (parts.length > 0) {
      return parts.join(', ');
    }
  }
  if (record.address != null && String(record.address).trim() !== '') {
    return String(record.address).trim();
  }
  return '—';
};

const STATUS_BADGE_STYLES = {
  paid: 'badge badge--success',
  partially_paid: 'badge badge--warning',
  unpaid: 'badge badge--danger',
  refund: 'badge badge--info',
  partially_refund: 'badge badge--info',
  completed: 'badge badge--success',
  'in-progress': 'badge badge--warning',
  cancelled: 'badge badge--danger',
  refunded: 'badge badge--info',
  pending: 'badge badge--warning',
  failed: 'badge badge--danger',
};

const statusBadge = (value) => {
  const raw = String(value ?? '—').trim();
  const key = raw.toLowerCase().replace(/\s+/g, '_');
  const cls = STATUS_BADGE_STYLES[key] || 'badge badge--neutral';
  return `<span class="${cls}">${escapeHtml(raw)}</span>`;
};

const moneyCell = (value) => `<span class="money">₹ ${formatMoney(value)}</span>`;

const buildServiceRows = (serviceItems) => {
  if (!Array.isArray(serviceItems) || serviceItems.length === 0) {
    return '<tr><td colspan="4" class="empty-row">No line items</td></tr>';
  }
  return serviceItems
    .map((item, index) => {
      const name = item.service_info?.name || item.service_info?.service_id || 'Service';
      const partner = item.partner_info?.name || '—';
      const price = formatMoney(
        item.total_service_charge ?? item.service_price ?? item.total_price ?? 0
      );
      const rowClass = index % 2 === 0 ? 'row-even' : 'row-odd';
      return `<tr class="${rowClass}">
        <td><span class="item-name">${escapeHtml(name)}</span></td>
        <td>${escapeHtml(partner)}</td>
        <td>${statusBadge(item.service_status || '—')}</td>
        <td class="col-amount"><span class="money">₹ ${price}</span></td>
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
      (c, index) => `<tr class="${index % 2 === 0 ? 'row-even' : 'row-odd'} charge-row">
        <td colspan="3">
          <span class="charge-label">${escapeHtml(c.label || c.charge_type || 'Additional charge')}</span>
          <span class="charge-tag">Additional</span>
        </td>
        <td class="col-amount">${moneyCell(c.total_amount ?? c.amount)}</td>
      </tr>`
    )
    .join('');
};

const buildPaymentRows = (payments) => {
  const customerPayments = (payments || []).filter((p) => p.payer_type === 'customer');
  if (customerPayments.length === 0) {
    return '<tr><td colspan="4" class="empty-row">No payments recorded</td></tr>';
  }
  return customerPayments
    .map(
      (p, index) => `<tr class="${index % 2 === 0 ? 'row-even' : 'row-odd'}">
        <td>${formatDate(p.paid_at || p.created_at)}</td>
        <td><span class="method-pill">${escapeHtml(p.payment_method || '—')}</span></td>
        <td>${statusBadge(p.status || '—')}</td>
        <td class="col-amount">${moneyCell(p.amount)}</td>
      </tr>`
    )
    .join('');
};

const buildTotalsRows = (record) => {
  const rows = [
    { label: 'Subtotal', value: record.sub_total },
    { label: `Tax (${formatMoney(record.tax_percent)}%)`, value: record.tax_amount ?? record.tax },
    { label: 'Discount', value: record.discount_amount ?? 0, muted: true },
    { label: 'Additional charges', value: record.additional_charges_total },
  ];

  return rows
    .map(
      (row) => `<div class="total-line${row.muted ? ' total-line--muted' : ''}">
        <span>${escapeHtml(row.label)}</span>
        <span>${moneyCell(row.value)}</span>
      </div>`
    )
    .join('');
};

const INVOICE_STYLES = `
  :root {
    --brand: #0f766e;
    --brand-dark: #0d5c56;
    --brand-light: #ccfbf1;
    --ink: #0f172a;
    --muted: #64748b;
    --border: #e2e8f0;
    --surface: #f8fafc;
    --white: #ffffff;
    --success: #059669;
    --warning: #d97706;
    --danger: #dc2626;
    --info: #0284c7;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 32px 24px;
    font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    color: var(--ink);
    background: #eef2f7;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .invoice {
    max-width: 820px;
    margin: 0 auto;
    background: var(--white);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
    border: 1px solid var(--border);
  }

  .invoice-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    padding: 32px 36px 28px;
    background: linear-gradient(135deg, var(--brand) 0%, var(--brand-dark) 100%);
    color: var(--white);
  }

  .brand-block { flex: 1; min-width: 0; }

  .brand-name {
    margin: 0 0 6px;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .brand-sub {
    margin: 0;
    font-size: 14px;
    opacity: 0.9;
  }

  .franchise-line {
    margin-top: 14px;
    font-size: 13px;
    opacity: 0.85;
  }

  .invoice-meta {
    text-align: right;
    flex-shrink: 0;
  }

  .invoice-label {
    display: inline-block;
    margin-bottom: 8px;
    padding: 6px 14px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .invoice-id {
    margin: 0 0 4px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .invoice-date {
    margin: 0;
    font-size: 13px;
    opacity: 0.9;
  }

  .status-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 14px 36px;
    background: var(--brand-light);
    border-bottom: 1px solid #99f6e4;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--brand-dark);
    font-weight: 500;
  }

  .status-item strong {
    font-weight: 600;
    color: var(--ink);
  }

  .invoice-body { padding: 28px 36px 36px; }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 28px;
  }

  .info-card {
    padding: 18px 20px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .info-card--accent {
    background: linear-gradient(180deg, #f0fdfa 0%, var(--surface) 100%);
    border-color: #99f6e4;
  }

  .card-title {
    margin: 0 0 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .card-name {
    margin: 0 0 6px;
    font-size: 17px;
    font-weight: 700;
    color: var(--ink);
  }

  .card-line {
    margin: 0 0 4px;
    font-size: 13px;
    color: var(--muted);
  }

  .card-line:last-child { margin-bottom: 0; }

  .service-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .service-pill {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--white);
    border: 1px solid var(--border);
    font-size: 12px;
    font-weight: 500;
    color: var(--ink);
  }

  .section { margin-bottom: 28px; }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .section-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--ink);
  }

  .section-count {
    font-size: 12px;
    color: var(--muted);
    font-weight: 500;
  }

  .table-wrap {
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  thead th {
    padding: 12px 16px;
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  thead th.col-amount,
  td.col-amount { text-align: right; }

  tbody td {
    padding: 13px 16px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  tbody tr:last-child td { border-bottom: none; }

  .row-even { background: var(--white); }
  .row-odd { background: #fafbfc; }

  .item-name { font-weight: 600; color: var(--ink); }

  .charge-label { font-weight: 500; }

  .charge-tag {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 8px;
    border-radius: 4px;
    background: #fef3c7;
    color: #92400e;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    vertical-align: middle;
  }

  .empty-row {
    text-align: center;
    color: var(--muted);
    font-style: italic;
    padding: 24px 16px !important;
  }

  .money {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    white-space: nowrap;
  }

  .method-pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 12px;
    text-transform: capitalize;
  }

  .badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    text-transform: capitalize;
    letter-spacing: 0.02em;
  }

  .badge--success { background: #d1fae5; color: var(--success); }
  .badge--warning { background: #fef3c7; color: var(--warning); }
  .badge--danger  { background: #fee2e2; color: var(--danger); }
  .badge--info    { background: #e0f2fe; color: var(--info); }
  .badge--neutral { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }

  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 24px;
    align-items: start;
  }

  .payments-block { min-width: 0; }

  .totals-card {
    padding: 20px 22px;
    border-radius: 12px;
    background: linear-gradient(180deg, #f0fdfa 0%, var(--white) 100%);
    border: 1px solid #99f6e4;
  }

  .totals-title {
    margin: 0 0 14px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--brand-dark);
  }

  .total-line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 7px 0;
    font-size: 13px;
    color: var(--ink);
    border-bottom: 1px dashed var(--border);
  }

  .total-line:last-of-type { border-bottom: none; }

  .total-line--muted span:first-child { color: var(--muted); }

  .total-line--grand {
    margin-top: 10px;
    padding-top: 14px;
    border-top: 2px solid var(--brand);
    border-bottom: none;
    font-size: 16px;
    font-weight: 700;
    color: var(--brand-dark);
  }

  .total-line--grand .money {
    font-size: 20px;
    color: var(--brand);
  }

  .total-line--paid {
    color: var(--success);
    font-weight: 600;
  }

  .total-line--due {
    font-weight: 700;
    color: var(--danger);
    background: #fef2f2;
    margin: 8px -10px 0;
    padding: 10px 10px !important;
    border-radius: 8px;
    border: none !important;
  }

  .invoice-footer {
    padding: 20px 36px 28px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    text-align: center;
  }

  .footer-thanks {
    margin: 0 0 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
  }

  .footer-note {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }

  @media print {
    body {
      padding: 0;
      background: var(--white);
    }

    .invoice {
      max-width: none;
      box-shadow: none;
      border: none;
      border-radius: 0;
    }

    .invoice-header {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .status-strip,
    .info-card--accent,
    .totals-card {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }

  @media (max-width: 640px) {
    body { padding: 12px; }

    .invoice-header {
      flex-direction: column;
      padding: 24px 20px;
    }

    .invoice-meta { text-align: left; }

    .status-strip,
    .invoice-body,
    .invoice-footer { padding-left: 20px; padding-right: 20px; }

    .info-grid,
    .summary-grid {
      grid-template-columns: 1fr;
    }
  }
`;

/**
 * Build a printable HTML invoice from a shaped order detail record (loadOrderDetailLean).
 */
const buildOrderInvoiceHtml = (record) => {
  const orderId = record.unique_id || record._id;
  const customerName = record.user_info?.name || '—';
  const customerEmail = record.user_info?.email || '—';
  const customerPhone = record.user_info?.phone_number || '—';
  const franchiseName = record.franchise_info?.name || 'Help PR';
  const franchiseLocation = [record.franchise_info?.city_name, record.franchise_info?.state_name]
    .filter((part) => part != null && String(part).trim() !== '')
    .join(', ');
  const address = formatAddressLine(record);
  const category = record.category_info?.name || '—';
  const service = record.service_info?.name || '—';
  const paymentStatus = record.user_payment_status || record.payment_status || '—';
  const orderStatus = record.order_status || '—';
  const serviceItemCount = Array.isArray(record.service_items) ? record.service_items.length : 0;
  const chargeCount = Array.isArray(record.additional_charges) ? record.additional_charges.length : 0;
  const lineItemCount = serviceItemCount + chargeCount;
  const paymentCount = (record.order_payments || []).filter((p) => p.payer_type === 'customer').length;
  const dueAmount = Number(record.customer_due_amount) || 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${escapeHtml(orderId)}</title>
  <style>${INVOICE_STYLES}</style>
</head>
<body>
  <div class="invoice">
    <header class="invoice-header">
      <div class="brand-block">
        <h1 class="brand-name">Help PR</h1>
        <p class="brand-sub">Service order invoice</p>
        <div class="franchise-line">
          <strong>${escapeHtml(franchiseName)}</strong>${franchiseLocation ? ` · ${escapeHtml(franchiseLocation)}` : ''}
        </div>
      </div>
      <div class="invoice-meta">
        <span class="invoice-label">Tax Invoice</span>
        <p class="invoice-id">#${escapeHtml(orderId)}</p>
        <p class="invoice-date">Issued ${formatDate(record.order_date || record.created_at)}</p>
      </div>
    </header>

    <div class="status-strip">
      <div class="status-item"><strong>Order</strong> ${statusBadge(orderStatus)}</div>
      <div class="status-item"><strong>Payment</strong> ${statusBadge(paymentStatus)}</div>
    </div>

    <div class="invoice-body">
      <div class="info-grid">
        <div class="info-card info-card--accent">
          <h2 class="card-title">Bill to</h2>
          <p class="card-name">${escapeHtml(customerName)}</p>
          <p class="card-line">${escapeHtml(customerEmail)}</p>
          <p class="card-line">${escapeHtml(customerPhone)}</p>
          <p class="card-line">${escapeHtml(address)}</p>
        </div>
        <div class="info-card">
          <h2 class="card-title">Service details</h2>
          <div class="service-pills">
            <span class="service-pill">${escapeHtml(category)}</span>
            <span class="service-pill">${escapeHtml(service)}</span>
          </div>
        </div>
      </div>

      <section class="section">
        <div class="section-head">
          <h2 class="section-title">Line items</h2>
          <span class="section-count">${lineItemCount} item${lineItemCount === 1 ? '' : 's'}</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Partner</th>
                <th>Status</th>
                <th class="col-amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${buildServiceRows(record.service_items)}
              ${buildChargeRows(record.additional_charges)}
            </tbody>
          </table>
        </div>
      </section>

      <div class="summary-grid">
        <section class="section payments-block">
          <div class="section-head">
            <h2 class="section-title">Payment history</h2>
            <span class="section-count">${paymentCount} payment${paymentCount === 1 ? '' : 's'}</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th class="col-amount">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${buildPaymentRows(record.order_payments)}
              </tbody>
            </table>
          </div>
        </section>

        <aside class="totals-card">
          <h2 class="totals-title">Amount summary</h2>
          ${buildTotalsRows(record)}
          <div class="total-line total-line--grand">
            <span>Total</span>
            <span>${moneyCell(record.total_price)}</span>
          </div>
          <div class="total-line total-line--paid">
            <span>Paid</span>
            <span>${moneyCell(record.customer_net_paid)}</span>
          </div>
          <div class="total-line total-line--due">
            <span>Amount due</span>
            <span>${moneyCell(dueAmount)}</span>
          </div>
        </aside>
      </div>
    </div>

    <footer class="invoice-footer">
      <p class="footer-thanks">Thank you for choosing Help PR</p>
      <p class="footer-note">This is a computer-generated invoice and does not require a signature.</p>
    </footer>
  </div>
</body>
</html>`;
};

module.exports = { buildOrderInvoiceHtml, escapeHtml };
