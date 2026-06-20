const fs = require('fs');
const path = require('path');

const INVOICE_LOGO_URL =
  'http://helper-admin-dashboard-staging.s3-website.ap-south-1.amazonaws.com/static/media/login_logo.dd37de4b8ee5c0dddd7a63cb3e3b7a5c.svg';

const loadInvoiceLogoDataUrl = (filePath, fallbackUrl, label) => {
  try {
    const logoBuffer = fs.readFileSync(filePath);
    return `data:image/png;base64,${logoBuffer.toString('base64')}`;
  } catch (err) {
    console.error(`Failed to load ${label} invoice logo:`, err.message);
    return fallbackUrl;
  }
};

const USER_INVOICE_LOGO_PATH = path.join(__dirname, '../public/static/user-invoice-logo.png');
const PARTNER_INVOICE_LOGO_PATH = path.join(
  __dirname,
  '../public/static/partner-invoice-logo.png'
);
const USER_INVOICE_LOGO_URL = loadInvoiceLogoDataUrl(
  USER_INVOICE_LOGO_PATH,
  INVOICE_LOGO_URL,
  'user'
);
const PARTNER_INVOICE_LOGO_URL = loadInvoiceLogoDataUrl(
  PARTNER_INVOICE_LOGO_PATH,
  INVOICE_LOGO_URL,
  'partner'
);
const INVOICE_BRAND_NAME = 'Help PR';
const INVOICE_TAGLINE = 'Trusted Home Services';
const INVOICE_SUPPORT_PHONE = '+91 1800-123-4567';
const INVOICE_SUPPORT_EMAIL = 'support@helppr.in';
const INVOICE_SUPPORT_WEBSITE = 'www.helppr.in';

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

const formatDateTime = (value = new Date()) => {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
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

const STATUS_COLOR_CLASS = {
  paid: 'text-success',
  partially_paid: 'text-warning',
  unpaid: 'text-danger',
  refund: 'text-info',
  partially_refund: 'text-info',
  completed: 'text-success',
  'in-progress': 'text-warning',
  cancelled: 'text-danger',
  refunded: 'text-info',
  pending: 'text-warning',
  failed: 'text-danger',
};

const statusText = (value) => {
  const raw = String(value ?? '—').trim();
  const key = raw.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  const normalizedKey = key === 'in_progress' ? 'in-progress' : key;
  const cls = STATUS_COLOR_CLASS[normalizedKey] || STATUS_COLOR_CLASS[key] || '';
  const display = raw === '—' ? raw : raw.replace(/_/g, ' ').replace(/-/g, ' ');
  return `<span class="${cls}">${escapeHtml(display)}</span>`;
};

const moneyCell = (value) => `₹ ${formatMoney(value)}`;

const iconSvg = (name) => {
  const icons = {
    person:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    tools:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4z"/><path d="M16 4l4 4"/></svg>',
    list:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    card:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
    store:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l2-5h14l2 5"/><path d="M5 9v10h14V9"/><path d="M9 19V12h6v7"/></svg>',
    mail:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    phone:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.5 2.6a2 2 0 0 1-.5 1.9L8 9a16 16 0 0 0 6 6l.8-1.1a2 2 0 0 1 1.9-.5c.9.2 1.7.4 2.6.5A2 2 0 0 1 22 16.9z"/></svg>',
    pin:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    headset:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14a8 8 0 0 1 16 0"/><path d="M4 14v3a2 2 0 0 0 2 2h1v-7H6a2 2 0 0 0-2 2z"/><path d="M20 14v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2z"/></svg>',
    doc:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
  };
  return icons[name] || '';
};

const buildServiceRows = (serviceItems) => {
  if (!Array.isArray(serviceItems) || serviceItems.length === 0) {
    return '<tr><td colspan="4" class="empty-row">No line items</td></tr>';
  }
  return serviceItems
    .map((item) => {
      const name = item.service_info?.name || item.service_info?.service_id || 'Service';
      const partner = item.partner_info?.name || '—';
      const price = formatMoney(
        item.total_service_charge ?? item.service_price ?? item.total_price ?? 0
      );
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(partner)}</td>
        <td>${statusText(item.service_status || '—')}</td>
        <td class="col-amount">₹ ${price}</td>
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
        <td>${escapeHtml(c.label || c.charge_type || 'Additional charge')}</td>
        <td>—</td>
        <td><span class="text-muted">additional</span></td>
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
      (p) => `<tr>
        <td>${formatDate(p.paid_at || p.created_at)}</td>
        <td>${escapeHtml(p.payment_method || '—')}</td>
        <td>${statusText(p.status || '—')}</td>
        <td class="col-amount">${moneyCell(p.amount)}</td>
      </tr>`
    )
    .join('');
};

const buildTotalsTable = (record) => {
  const rows = [
    { label: 'Subtotal', value: record.sub_total },
    { label: `Tax (${formatMoney(record.tax_percent)}%)`, value: record.tax_amount ?? record.tax },
    { label: 'Discount', value: record.discount_amount ?? 0 },
    { label: 'Additional Charges', value: record.additional_charges_total },
  ];

  const body = rows
    .map(
      (row) => `<tr>
        <td class="totals-label">${escapeHtml(row.label)}</td>
        <td class="totals-value">${moneyCell(row.value)}</td>
      </tr>`
    )
    .join('');

  return `<table class="totals-table">
    <tbody>
      ${body}
      <tr class="totals-grand">
        <td class="totals-label">Grand Total</td>
        <td class="totals-value">${moneyCell(record.total_price)}</td>
      </tr>
      <tr class="totals-paid">
        <td class="totals-label">Paid</td>
        <td class="totals-value">${moneyCell(record.customer_net_paid)}</td>
      </tr>
      <tr class="totals-due">
        <td class="totals-label">Due</td>
        <td class="totals-value">${moneyCell(record.customer_due_amount)}</td>
      </tr>
    </tbody>
  </table>`;
};

const INVOICE_STYLES = `
  :root {
    --navy: #1a3a5c;
    --navy-dark: #0f2744;
    --blue: #2563eb;
    --blue-light: #e8f4fc;
    --blue-soft: #d6ebfa;
    --ink: #1e293b;
    --muted: #64748b;
    --border: #d8e2ec;
    --white: #ffffff;
    --success: #16a34a;
    --partner-orange: #f97316;
    --warning: #d97706;
    --danger: #dc2626;
    --info: #0284c7;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 28px 16px;
    font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    color: var(--ink);
    background: #edf2f7;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }

  .invoice {
    max-width: 860px;
    margin: 0 auto;
    background: var(--white);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 8px 30px rgba(26, 58, 92, 0.08);
  }

  .top-bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
    flex-wrap: wrap;
    padding: 28px 32px 20px;
    border-bottom: 1px solid var(--border);
  }

  .brand-wrap {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: 1 1 220px;
    min-width: 0;
  }

  .top-bar--badge .brand-wrap {
    flex: 1 1 260px;
    min-width: min(100%, 260px);
  }

  .brand-logo {
    width: 52px;
    height: 52px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .brand-logo--badge {
    width: 72px;
    height: 72px;
    border-radius: 50%;
  }

  .brand-text {
    flex: 0 0 auto;
    min-width: max-content;
  }

  .brand-name {
    margin: 0;
    font-size: 28px;
    font-weight: 800;
    color: var(--navy);
    letter-spacing: -0.02em;
    line-height: 1.1;
    white-space: nowrap;
  }

  .brand-name span { color: var(--success); }

  .brand-name--accent span {
    color: var(--partner-orange);
    font-weight: 900;
  }

  .brand-tagline {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--muted);
    font-weight: 500;
  }

  .invoice-title {
    margin: 0;
    font-size: 34px;
    font-weight: 800;
    color: var(--navy);
    letter-spacing: 0.04em;
    line-height: 1;
    flex: 0 0 auto;
    margin-left: auto;
  }

  .meta-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 24px;
    padding: 18px 32px 22px;
    border-bottom: 1px solid var(--border);
    align-items: start;
  }

  .meta-list {
    display: grid;
    gap: 7px;
    font-size: 14px;
  }

  .meta-item {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: 8px;
    align-items: baseline;
  }

  .meta-label {
    color: var(--muted);
    font-weight: 500;
  }

  .meta-value { color: var(--ink); font-weight: 600; }

  .meta-value--link { color: var(--blue); }

  .franchise-box {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: #fafcff;
    min-width: 200px;
  }

  .franchise-icon {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: var(--blue-light);
    color: var(--navy);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .franchise-icon svg { width: 22px; height: 22px; }

  .franchise-label {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
    font-weight: 500;
  }

  .franchise-name {
    margin: 2px 0 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--navy);
  }

  .cards-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    padding: 22px 32px;
  }

  .info-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    background: var(--white);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 16px;
    background: var(--navy);
    color: var(--white);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .card-header svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .card-body { padding: 16px 18px; }

  .customer-name {
    margin: 0 0 12px;
    font-size: 18px;
    font-weight: 700;
    color: var(--navy);
  }

  .detail-line {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--ink);
  }

  .detail-line:last-child { margin-bottom: 0; }

  .detail-line svg {
    width: 15px;
    height: 15px;
    color: var(--muted);
    flex-shrink: 0;
    margin-top: 2px;
  }

  .service-field {
    margin: 0 0 10px;
    font-size: 14px;
  }

  .service-field:last-child { margin-bottom: 0; }

  .service-field strong {
    color: var(--muted);
    font-weight: 600;
    margin-right: 6px;
  }

  .section {
    margin: 0 32px 22px;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 16px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .section-header svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .section-header--light {
    background: var(--blue-light);
    color: var(--navy);
    border-bottom: 1px solid var(--blue-soft);
  }

  .section-header--dark {
    background: var(--navy);
    color: var(--white);
  }

  .table-wrap { overflow-x: auto; }

  table.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .data-table thead th {
    padding: 11px 16px;
    text-align: left;
    font-size: 12px;
    font-weight: 700;
    color: var(--navy);
    background: var(--blue-light);
    border-bottom: 1px solid var(--blue-soft);
  }

  .data-table thead th.col-amount,
  .data-table td.col-amount {
    text-align: right;
    white-space: nowrap;
  }

  .data-table tbody td {
    padding: 12px 16px;
    border-bottom: 1px solid #edf2f7;
    vertical-align: middle;
  }

  .data-table tbody tr:last-child td { border-bottom: none; }

  .data-table tbody tr:nth-child(even) { background: #fbfdff; }

  .empty-row {
    text-align: center;
    color: var(--muted);
    font-style: italic;
    padding: 22px 16px !important;
  }

  .totals-wrap {
    display: flex;
    justify-content: flex-end;
    padding: 14px 16px 18px;
    border-top: 1px solid #edf2f7;
    background: #fbfdff;
  }

  .totals-table {
    border-collapse: collapse;
    min-width: 280px;
    font-size: 14px;
  }

  .totals-table td {
    padding: 6px 0 6px 24px;
    vertical-align: middle;
  }

  .totals-label {
    text-align: right;
    color: var(--muted);
    font-weight: 500;
    padding-right: 20px !important;
    white-space: nowrap;
  }

  .totals-value {
    text-align: right;
    font-weight: 700;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    min-width: 110px;
  }

  .totals-grand td {
    padding-top: 10px;
    background: var(--blue-light);
  }

  .totals-grand .totals-label,
  .totals-grand .totals-value {
    font-size: 15px;
    font-weight: 800;
    color: var(--navy);
    padding-top: 10px;
    padding-bottom: 10px;
  }

  .totals-paid .totals-value { color: var(--success); }
  .totals-due .totals-value { color: var(--danger); }

  .text-success { color: var(--success); font-weight: 600; text-transform: lowercase; }
  .text-warning { color: var(--warning); font-weight: 600; text-transform: lowercase; }
  .text-danger  { color: var(--danger); font-weight: 600; text-transform: lowercase; }
  .text-info    { color: var(--info); font-weight: 600; text-transform: lowercase; }
  .text-muted   { color: var(--muted); font-weight: 500; text-transform: lowercase; }

  .invoice-footer {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0;
    border-top: 1px solid var(--border);
    background: #fafcff;
  }

  .footer-col {
    padding: 22px 24px;
    border-right: 1px solid var(--border);
    font-size: 12px;
    color: var(--muted);
  }

  .footer-col:last-child { border-right: none; }

  .footer-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--navy);
  }

  .footer-head svg {
    width: 16px;
    height: 16px;
    color: var(--navy);
  }

  .footer-line { margin: 0 0 4px; }
  .footer-line:last-child { margin-bottom: 0; }

  .footer-center { text-align: center; }

  .footer-thanks {
    margin: 0 0 6px;
    font-family: "Segoe Script", "Brush Script MT", cursive;
    font-size: 26px;
    color: var(--navy);
    font-weight: 400;
    line-height: 1.2;
  }

  .footer-sub {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
    line-height: 1.5;
  }

  .footer-right { text-align: right; }

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

    .card-header,
    .section-header--dark,
    .section-header--light,
    .data-table thead th,
    .totals-grand td {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }

  @media (max-width: 720px) {
    body { padding: 10px; }

    .top-bar,
    .meta-row,
    .cards-grid {
      padding-left: 18px;
      padding-right: 18px;
    }

    .top-bar { flex-direction: column; }
    .invoice-title { font-size: 28px; }

    .meta-row { grid-template-columns: 1fr; }
    .cards-grid { grid-template-columns: 1fr; }
    .section { margin-left: 18px; margin-right: 18px; }

    .invoice-footer {
      grid-template-columns: 1fr;
    }

    .footer-col {
      border-right: none;
      border-bottom: 1px solid var(--border);
    }

    .footer-col:last-child { border-bottom: none; }
    .footer-right { text-align: left; }
  }
`;

/**
 * Build a printable HTML invoice from a shaped order detail record (loadOrderDetailLean).
 * @param {object} record
 * @param {{ audience?: 'user' | 'partner' }} [options]
 */
const buildOrderInvoiceHtml = (record, options = {}) => {
  const isPartnerInvoice = options.audience === 'partner';
  const isUserMobileInvoice = options.audience === 'user';
  const isBadgeLogoInvoice = isPartnerInvoice || isUserMobileInvoice;
  const logoUrl = isPartnerInvoice
    ? PARTNER_INVOICE_LOGO_URL
    : isUserMobileInvoice
      ? USER_INVOICE_LOGO_URL
      : INVOICE_LOGO_URL;
  const logoClass = isBadgeLogoInvoice ? 'brand-logo brand-logo--badge' : 'brand-logo';
  const brandNameClass = isBadgeLogoInvoice ? 'brand-name brand-name--accent' : 'brand-name';
  const topBarClass = isBadgeLogoInvoice ? 'top-bar top-bar--badge' : 'top-bar';
  const orderId = record.unique_id || record._id;
  const invoiceNo = `INV-${orderId}`;
  const customerName = record.user_info?.name || '—';
  const customerEmail = record.user_info?.email || '—';
  const customerPhone = record.user_info?.phone_number || '—';
  const franchiseName = record.franchise_info?.name || '—';
  const address = formatAddressLine(record);
  const category = record.category_info?.name || '—';
  const service = record.service_info?.name || '—';
  const paymentStatus = record.user_payment_status || record.payment_status || '—';
  const orderStatus = record.order_status || '—';
  const invoiceDate = formatDate(record.order_date || record.created_at);
  const generatedAt = formatDateTime(new Date());
  const brandParts = String(INVOICE_BRAND_NAME).trim().split(/\s+/);
  const brandNameHtml =
    brandParts.length > 1
      ? `${escapeHtml(brandParts[0])} <span>${escapeHtml(brandParts.slice(1).join(' '))}</span>`
      : escapeHtml(INVOICE_BRAND_NAME);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${escapeHtml(invoiceNo)}</title>
  <style>${INVOICE_STYLES}</style>
</head>
<body>
  <div class="invoice">
    <div class="${topBarClass}">
      <div class="brand-wrap">
        <img class="${logoClass}" src="${logoUrl}" alt="${escapeHtml(INVOICE_BRAND_NAME)} logo" />
        <div class="brand-text">
          <h1 class="${brandNameClass}">${brandNameHtml}</h1>
          <p class="brand-tagline">${escapeHtml(INVOICE_TAGLINE)}</p>
        </div>
      </div>
      <h2 class="invoice-title">INVOICE</h2>
    </div>

    <div class="meta-row">
      <div class="meta-list">
        <div class="meta-item">
          <span class="meta-label">Invoice No.</span>
          <span class="meta-value">${escapeHtml(invoiceNo)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Order ID</span>
          <span class="meta-value meta-value--link">${escapeHtml(orderId)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Invoice Date</span>
          <span class="meta-value">${escapeHtml(invoiceDate)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Order Status</span>
          <span class="meta-value">${statusText(orderStatus)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Payment Status</span>
          <span class="meta-value">${statusText(paymentStatus)}</span>
        </div>
      </div>
      <div class="franchise-box">
        <div class="franchise-icon">${iconSvg('store')}</div>
        <div>
          <p class="franchise-label">Franchise</p>
          <p class="franchise-name">${escapeHtml(franchiseName)}</p>
        </div>
      </div>
    </div>

    <div class="cards-grid">
      <div class="info-card">
        <div class="card-header">${iconSvg('person')} Bill to</div>
        <div class="card-body">
          <p class="customer-name">${escapeHtml(customerName)}</p>
          <p class="detail-line">${iconSvg('mail')}<span>${escapeHtml(customerEmail)}</span></p>
          <p class="detail-line">${iconSvg('phone')}<span>${escapeHtml(customerPhone)}</span></p>
          <p class="detail-line">${iconSvg('pin')}<span>${escapeHtml(address)}</span></p>
        </div>
      </div>
      <div class="info-card">
        <div class="card-header">${iconSvg('tools')} Service details</div>
        <div class="card-body">
          <p class="service-field"><strong>Category:</strong>${escapeHtml(category)}</p>
          <p class="service-field"><strong>Service:</strong>${escapeHtml(service)}</p>
        </div>
      </div>
    </div>

    <section class="section">
      <div class="section-header section-header--light">${iconSvg('list')} Line items</div>
      <div class="table-wrap">
        <table class="data-table">
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
      <div class="totals-wrap">
        ${buildTotalsTable(record)}
      </div>
    </section>

    <section class="section">
      <div class="section-header section-header--dark">${iconSvg('card')} Payment history</div>
      <div class="table-wrap">
        <table class="data-table">
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

    <footer class="invoice-footer">
      <div class="footer-col">
        <div class="footer-head">${iconSvg('headset')} Need Help?</div>
        <p class="footer-line">${escapeHtml(INVOICE_SUPPORT_PHONE)}</p>
        <p class="footer-line">${escapeHtml(INVOICE_SUPPORT_EMAIL)}</p>
        <p class="footer-line">${escapeHtml(INVOICE_SUPPORT_WEBSITE)}</p>
      </div>
      <div class="footer-col footer-center">
        <p class="footer-thanks">Thank You!</p>
        <p class="footer-sub">for choosing ${escapeHtml(INVOICE_BRAND_NAME)}.<br />We appreciate your business.</p>
      </div>
      <div class="footer-col footer-right">
        <div class="footer-head">${iconSvg('doc')} Generated On</div>
        <p class="footer-line">${escapeHtml(generatedAt)}</p>
      </div>
    </footer>
  </div>
</body>
</html>`;
};

module.exports = { buildOrderInvoiceHtml, escapeHtml };
