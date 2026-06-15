/**
 * Merges all Help PR Postman collections into one file.
 * Run: node postman/merge-all-collections.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_FILE = 'Help-PR-All-APIs.postman_collection.json';
const ARCHIVE_DIR = 'archive';

/** Higher index = lower priority (dropped on duplicate). Paths under postman/archive/. */
const SOURCE_FILES = [
  'Help-PR-Orders-Module.postman_collection.json',
  'Help-PR-Order-Charges-Payments.postman_collection.json',
  'Help-PR-Partner-Franchise-Dropdowns.postman_collection.json',
  'content-expense-expense-category-management.postman_collection (1).json',
  'Area-Management.postman_collection.json',
  'Help-PR-Area-Franchise-Subscription-UserTypes.postman_collection.json',
  'Help-PR-Area-Franchise-Subscription.postman_collection.json',
  'Help-PR-Admin-Dashboard.postman_collection.json',
];

const SKIP_PATTERNS = [
  /^Help-PR-All-APIs\./,
  /^Help-PR-Combined-All-Modules\./,
  /\(1\)\.json$/,
];

const MODULE_ORDER = [
  'auth',
  'otp',
  'getCount',
  'dashboard',
  'state',
  'city',
  'area',
  'franchise',
  'franchise-category',
  'franchise-service',
  'category',
  'service',
  'user',
  'subscription-plan',
  'partner-subscription',
  'partner_service',
  'partner_category',
  'partner_document',
  'document',
  'document_upload',
  'bank_account',
  'order',
  'order-additional-charges',
  'order-payments',
  'financial-order-payments',
  'quote',
  'order_service',
  'address',
  'tax',
  'ticket',
  'notification_settings',
  'notification',
  'razorpay',
  'export',
  'user_home_counts',
  'quote_settings',
  'content-management',
  'expense-category-management',
  'expense-management',
  'partner_payout',
  'chat',
  'health',
  'offer',
  'other',
];

const MODULE_LABELS = {
  auth: 'Auth',
  otp: 'OTP',
  getCount: 'getCount',
  dashboard: 'Dashboard',
  state: 'State',
  city: 'City',
  area: 'Area',
  franchise: 'Franchise',
  'franchise-category': 'Franchise category',
  'franchise-service': 'Franchise service',
  category: 'Category (catalog)',
  service: 'Service (catalog)',
  user: 'User',
  'subscription-plan': 'Subscription plan',
  'partner-subscription': 'Partner subscription',
  partner_service: 'Partner service',
  partner_category: 'Partner category',
  partner_document: 'Partner document',
  document: 'Document',
  document_upload: 'Document upload',
  bank_account: 'Bank account',
  order: 'Order',
  'order-additional-charges': 'Order additional charges',
  'order-payments': 'Order payments',
  'financial-order-payments': 'Financial order payments',
  quote: 'Quote',
  order_service: 'Order service',
  address: 'Address',
  tax: 'Tax',
  ticket: 'Ticket',
  notification_settings: 'Notification settings',
  notification: 'Notification',
  razorpay: 'Razorpay',
  export: 'Export',
  user_home_counts: 'User home counts',
  quote_settings: 'Quote settings',
  'content-management': 'Content management',
  'expense-category-management': 'Expense category management',
  'expense-management': 'Expense management',
  partner_payout: 'Partner payout',
  chat: 'Chat',
  health: 'Health',
  offer: 'Offer',
  other: 'Other',
};

const FINANCIAL_PAYMENTS_DOC = 'docs/FINANCIAL_ORDER_PAYMENTS_API.md';

const MODULE_DESCRIPTIONS = {
  'financial-order-payments': [
    '**/api/order/financial-payments** — Financial — Order Payments overview (from `order` rows).',
    '',
    `**Doc:** \`${FINANCIAL_PAYMENTS_DOC}\``,
    '',
    '**Access:** Same as order getAll (super admin / staff / franchise admin / employee). Partner & customer → 403.',
    '',
    'Legacy `/api/financial-order/*` is archived under `archive/financial-order/`.',
  ].join('\n'),
  partner_payout: [
    '**/api/partner_payout** — Partner wallet (credits from orders, debits from withdrawals).',
    '',
    '**Frontend doc:** `docs/PARTNER_PAYOUT_FRONTEND.md`',
    '',
    '**Access:** Super admin (5) & staff (6) — all franchises; optional `franchise_id`. Franchise admin (1) & employee (3) — own franchise only; wrong `franchise_id` → **403**. Partner (2) & customer (4) → **403**.',
    '',
    '**Flow:** 1 getAll → 2 partners (pay modal) → 3 show (ledger) → 4 create.',
    '',
    '**Variable:** Set `partnerMongoId` to a row `_id` from getAll (Mongo ObjectId, not business `partner_id`).',
  ].join('\n'),
};

function flattenItems(items, folderPath = [], sourceFile = '') {
  const out = [];
  for (const item of items || []) {
    if (item.request) {
      out.push({
        item: structuredClone(item),
        folderPath,
        sourceFile,
      });
    }
    if (item.item) {
      out.push(
        ...flattenItems(item.item, [...folderPath, item.name], sourceFile)
      );
    }
  }
  return out;
}

function urlToPathString(url) {
  if (!url) return '';
  if (typeof url === 'string') return url;
  if (url.raw) return url.raw;
  const host = Array.isArray(url.host) ? url.host.join('') : url.host || '';
  const p = Array.isArray(url.path) ? url.path.join('/') : '';
  return `${host}/${p}`;
}

function normalizePath(pathStr) {
  let s = pathStr
    .replace(/\{\{baseUrl\}\}/gi, '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/\?.*$/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
  s = s.replace(/\{\{[^}]+\}\}/g, ':param');
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}

function getModuleKey(pathStr) {
  const normalized = normalizePath(pathStr);
  const m = normalized.match(/\/api\/([^/]+)/);
  if (!m) {
    if (normalized.includes('/health')) return 'health';
    return 'other';
  }
  const seg = m[1];
  if (seg === 'getcount' || pathStr.toLowerCase().includes('getcount')) return 'getCount';
  if (seg === 'order' && normalized.includes('/financial-payments')) {
    return 'financial-order-payments';
  }
  return seg;
}

function getRequestKey(req) {
  const method = (req.method || 'GET').toUpperCase();
  const pathStr = normalizePath(urlToPathString(req.url));
  let extra = '';
  if (method === 'POST' && pathStr.endsWith('/getcount')) {
    try {
      const raw = req.body?.raw || '';
      const parsed = JSON.parse(raw);
      if (parsed && parsed.type !== undefined) extra = `:type=${parsed.type}`;
    } catch {
      /* ignore */
    }
  }
  return `${method}:${pathStr}${extra}`;
}

function collectVariables(collection) {
  const map = new Map();
  for (const v of collection.variable || []) {
    if (v && v.key) map.set(v.key, { ...v });
  }
  return map;
}

const PARTNER_PAYOUT_DOC = 'docs/PARTNER_PAYOUT_FRONTEND.md';

function partnerPayoutBuiltinItems() {
  const auth = { key: 'Authorization', value: 'Bearer {{accessToken}}', type: 'text' };
  const base = '{{baseUrl}}';
  return [
    {
      name: '1. Get all — wallet list',
      request: {
        method: 'GET',
        header: [auth],
        url: {
          raw: `${base}/api/partner_payout/getAll?page=1&limit=10&search=&wallet_status=pending&from_date=2026-04-01&to_date=2026-05-20&franchise_id={{franchiseId}}&sort_by=partner_name&sort_order=asc`,
          host: [base],
          path: ['api', 'partner_payout', 'getAll'],
          query: [
            { key: 'page', value: '1', description: 'Default 1' },
            { key: 'limit', value: '10', description: 'Max 100' },
            { key: 'search', value: '', description: 'Partner name or business user_id' },
            { key: 'wallet_status', value: 'pending', description: 'pending | paid' },
            { key: 'from_date', value: '2026-04-01', description: 'Filter last_withdraw_date (optional)' },
            { key: 'to_date', value: '2026-05-20', description: 'Filter last_withdraw_date (optional)' },
            { key: 'franchise_id', value: '{{franchiseId}}', description: 'Mongo ObjectId' },
            { key: 'sort_by', value: 'partner_name', description: 'partner_name | total_wallet_amount | last_withdraw_date | wallet_status' },
            { key: 'sort_order', value: 'asc', description: 'asc | desc' },
          ],
        },
        description: [
          '**GET /api/partner_payout/getAll** — Partner wallet summary table.',
          '',
          `See **${PARTNER_PAYOUT_DOC}** §5.1. **Access:** §2.`,
          '',
          '**Response `data.records[]`:** `_id` (Mongo id for show/create), `partner_id` (business code), `partner_name`, `total_wallet_amount`, `last_withdraw_amount`, `last_withdraw_date` (YYYY-MM-DD), `wallet_status` (`pending` | `paid`).',
          '',
          'Copy row `_id` → collection variable `partnerMongoId` for show/create.',
        ].join('\n'),
      },
    },
    {
      name: '2. Partners — pay modal dropdown',
      request: {
        method: 'GET',
        header: [auth],
        url: {
          raw: `${base}/api/partner_payout/partners?franchise_id={{franchiseId}}&search=&limit=250`,
          host: [base],
          path: ['api', 'partner_payout', 'partners'],
          query: [
            { key: 'franchise_id', value: '{{franchiseId}}', description: 'Optional scope' },
            { key: 'search', value: '', description: 'Partner name or business user_id' },
            { key: 'limit', value: '250', description: 'Max 250' },
          ],
        },
        description: [
          '**GET /api/partner_payout/partners** — Dropdown for “Pay partner” modal.',
          '',
          `See **${PARTNER_PAYOUT_DOC}** §5.2. **Access:** §2.`,
          '',
          '**Response `data.records[]`:** `_id`, `partner_id`, `partner_name`, `total_wallet_amount`, **`payable_balance`** (max for `pay_now_amount`).',
        ].join('\n'),
      },
    },
    {
      name: '3. Show — wallet ledger',
      request: {
        method: 'GET',
        header: [auth],
        url: {
          raw: `${base}/api/partner_payout/show?id={{partnerMongoId}}&search=&from_date=2026-04-01&to_date=2026-05-20&transaction_type=&page=1&limit=10`,
          host: [base],
          path: ['api', 'partner_payout', 'show'],
          query: [
            { key: 'id', value: '{{partnerMongoId}}', description: 'Required — partner user._id (24-char ObjectId)' },
            { key: 'search', value: '', description: 'description | order_unique_id | payment_method' },
            { key: 'from_date', value: '2026-04-01' },
            { key: 'to_date', value: '2026-05-20' },
            { key: 'transaction_type', value: '', description: 'Optional: credit | debit (omit for all)' },
            { key: 'page', value: '1' },
            { key: 'limit', value: '10' },
          ],
        },
        description: [
          '**GET /api/partner_payout/show** — Credits & debits for one partner.',
          '',
          `See **${PARTNER_PAYOUT_DOC}** §5.3. **Access:** §2 — partner must be in caller franchise.`,
          '',
          '**Query:** `id` = partner Mongo `_id` (not business `partner_id` string).',
          '',
          '**Ledger rows:** `transaction_type` `credit` = order partner earning; `debit` = withdrawal.',
        ].join('\n'),
      },
    },
    {
      name: '4. Create — record withdrawal',
      request: {
        method: 'POST',
        header: [auth, { key: 'Content-Type', value: 'application/json', type: 'text' }],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              partner_id: '{{partnerMongoId}}',
              pay_now_amount: 3200,
              payment_method: 'upi',
              description: 'Partner withdrawal — ref UTR998877',
              franchise_id: '{{franchiseId}}',
            },
            null,
            2
          ),
          options: { raw: { language: 'json' } },
        },
        url: {
          raw: `${base}/api/partner_payout/create`,
          host: [base],
          path: ['api', 'partner_payout', 'create'],
        },
        description: [
          '**POST /api/partner_payout/create** — Pay partner (creates payout + ledger debit).',
          '',
          `See **${PARTNER_PAYOUT_DOC}** §5.4. **Access:** §2 — partner must be in caller franchise.`,
          '',
          '**Body:** `partner_id` = Mongo `_id` from list/dropdown; `pay_now_amount` ≤ `payable_balance`; `payment_method`: `upi` | `bank_transfer` | `cash` | `cheque` | `other`; `description` required.',
          '',
          '**201** on success. Refresh getAll/show to see updated balance.',
        ].join('\n'),
      },
    },
  ].map((item) => ({
    item,
    folderPath: ['Partner payout'],
    sourceFile: 'builtin:partner_payout',
  }));
}

function financialOrderPaymentsBuiltinItems() {
  const auth = { key: 'Authorization', value: 'Bearer {{accessToken}}', type: 'text' };
  const base = '{{baseUrl}}';
  return [
    {
      name: '1. List — financial payments grid',
      request: {
        method: 'GET',
        header: [auth],
        url: {
          raw: `${base}/api/order/financial-payments/getAll?page=1&limit=20&franchise_id={{franchiseId}}`,
          host: [base],
          path: ['api', 'order', 'financial-payments', 'getAll'],
          query: [
            { key: 'page', value: '1' },
            { key: 'limit', value: '20' },
            { key: 'franchise_id', value: '{{franchiseId}}' },
          ],
        },
        description: `**GET /api/order/financial-payments/getAll** — See **${FINANCIAL_PAYMENTS_DOC}**.`,
      },
    },
    {
      name: '2. Detail — one order',
      request: {
        method: 'GET',
        header: [auth],
        url: {
          raw: `${base}/api/order/financial-payments/get/{{orderId}}`,
          host: [base],
          path: ['api', 'order', 'financial-payments', 'get', '{{orderId}}'],
        },
        description: '**GET /api/order/financial-payments/get/:id** — order Mongo `_id`.',
      },
    },
  ].map((item) => ({
    item,
    folderPath: ['Financial order payments'],
    sourceFile: 'builtin:financial-order-payments',
  }));
}

function main() {
  const seen = new Map();
  const allVariables = new Map();

  const defaultVars = {
    baseUrl: { key: 'baseUrl', value: 'http://localhost:5001', type: 'string' },
    accessToken: {
      key: 'accessToken',
      value: '',
      type: 'string',
      description: 'JWT — set via Auth → Login (also sets token)',
    },
    token: {
      key: 'token',
      value: '',
      type: 'string',
      description: 'Alias for accessToken (legacy collections)',
    },
    orderId: { key: 'orderId', value: '', type: 'string' },
    orderServiceId: { key: 'orderServiceId', value: '', type: 'string' },
    franchiseId: { key: 'franchiseId', value: '', type: 'string' },
    partnerMongoId: {
      key: 'partnerMongoId',
      value: '',
      type: 'string',
      description: 'Partner user _id (Mongo ObjectId)',
    },
    additionalChargeId: { key: 'additionalChargeId', value: '', type: 'string' },
    orderPaymentId: { key: 'orderPaymentId', value: '', type: 'string' },
  };
  for (const [k, v] of Object.entries(defaultVars)) allVariables.set(k, v);

  const sourcesLoaded = [];

  for (const file of SOURCE_FILES) {
    const full = path.join(__dirname, ARCHIVE_DIR, file);
    if (!fs.existsSync(full)) {
      console.warn(`Skip missing: ${ARCHIVE_DIR}/${file}`);
      continue;
    }
    const collection = JSON.parse(fs.readFileSync(full, 'utf8'));
    sourcesLoaded.push(file);
    for (const [k, v] of collectVariables(collection)) {
      if (!allVariables.has(k)) allVariables.set(k, v);
    }
    const flat = flattenItems(collection.item, [], file);
    for (const entry of flat) {
      const key = getRequestKey(entry.item.request);
      if (!seen.has(key)) seen.set(key, entry);
    }
  }

  for (const entry of partnerPayoutBuiltinItems()) {
    const key = getRequestKey(entry.item.request);
    if (!seen.has(key)) seen.set(key, entry);
  }

  for (const entry of financialOrderPaymentsBuiltinItems()) {
    const key = getRequestKey(entry.item.request);
    if (!seen.has(key)) seen.set(key, entry);
  }

  const byModule = new Map();
  for (const entry of seen.values()) {
    const pathStr = urlToPathString(entry.item.request.url);
    const mod = getModuleKey(pathStr);
    if (!byModule.has(mod)) byModule.set(mod, []);
    byModule.get(mod).push(entry);
  }

  const sortedModules = [
    ...MODULE_ORDER.filter((m) => byModule.has(m)),
    ...[...byModule.keys()].filter((m) => !MODULE_ORDER.includes(m)).sort(),
  ];

  const collectionItems = sortedModules.map((mod, idx) => {
    const entries = byModule.get(mod);
    entries.sort((a, b) => a.item.name.localeCompare(b.item.name));
    const num = String(idx).padStart(2, '0');
    const label = MODULE_LABELS[mod] || mod;
    return {
      name: `${num} — ${label}`,
      description:
        MODULE_DESCRIPTIONS[mod] ||
        `**/api/${mod === 'getCount' ? 'getCount' : mod}** — ${entries.length} request(s). Duplicates merged across source collections.`,
      item: entries.map((e) => {
        const desc = e.item.description || '';
        const srcNote = e.sourceFile
          ? `\n\n_Source: ${e.sourceFile}${e.folderPath.length ? ' → ' + e.folderPath.join(' → ') : ''}_`
          : '';
        return {
          ...e.item,
          description: desc + srcNote,
        };
      }),
    };
  });

  const loginFolder = collectionItems.find((f) => f.name.includes('Auth'));
  if (loginFolder) {
    const login = loginFolder.item.find(
      (i) =>
        i.request &&
        i.request.method === 'POST' &&
        normalizePath(urlToPathString(i.request.url)).endsWith('/api/auth/login')
    );
    if (login && !login.event) {
      login.event = [
        {
          listen: 'test',
          script: {
            exec: [
              "try {",
              "  const j = pm.response.json();",
              "  const t = j?.record?.auth_token || j?.data?.auth_token || j?.token;",
              "  if (t) {",
              "    pm.collectionVariables.set('accessToken', t);",
              "    pm.collectionVariables.set('token', t);",
              "  }",
              "} catch (e) {}",
            ],
            type: 'text/javascript',
          },
        },
      ];
    }
  }

  const output = {
    info: {
      _postman_id: 'help-pr-all-apis-merged',
      name: 'Help PR — All APIs (single collection)',
      description: [
        '**Single Postman collection** for `help-pr-backend-staging`. Import only this file.',
        '',
        `**Generated:** ${new Date().toISOString().slice(0, 10)} via \`node postman/merge-all-collections.mjs\``,
        '',
        '**Sources merged (' + sourcesLoaded.length + ') from `postman/archive/`:**',
        ...sourcesLoaded.map((f) => `- \`archive/${f}\``),
        '- Built-in: Partner payout (4 requests), Financial order payments (2 requests)',
        '- Standalone: `Help-PR-Financial-Order-Payments.postman_collection.json` (includes getCount type 4)',
        '',
        '**Dedup:** Same HTTP method + path template (+ getCount `type` in body) → one request; higher-priority source wins.',
        '',
        '**Setup:** Set `baseUrl`. Run **00 — Auth → Login** to set `accessToken` / `token`.',
        '',
        '**Docs:** `docs/ORDER_MODULE_FRONTEND.md`, `docs/ORDER_GETALL_API_CHANGES.md`, `docs/PARTNER_PAYOUT_FRONTEND.md`',
      ].join('\n'),
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: collectionItems,
    variable: [...allVariables.values()],
  };

  const outPath = path.join(__dirname, OUTPUT_FILE);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  const totalRequests = [...seen.values()].length;
  console.log(`Wrote ${OUTPUT_FILE}`);
  console.log(`  Modules: ${collectionItems.length}`);
  console.log(`  Requests: ${totalRequests}`);
  console.log(`  Variables: ${output.variable.length}`);
}

main();
