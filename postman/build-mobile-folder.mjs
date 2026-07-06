/**
 * Rebuilds **Mobile → Partner** and **Mobile → User** in Help-PR-All-APIs.postman_collection.json
 * Run: node postman/build-mobile-folder.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COLLECTION_FILE = path.join(__dirname, 'Help-PR-All-APIs.postman_collection.json');
const MOBILE_ONLY_FILE = path.join(__dirname, 'Help-PR-Mobile-APIs.postman_collection.json');

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
    .replace(/\{\{base_url\}\}/gi, '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/\?.*$/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
  s = s.replace(/\{\{[^}]+\}\}/g, ':param');
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}

function getRequestKey(req) {
  const method = (req.method || 'GET').toUpperCase();
  const pathStr = normalizePath(urlToPathString(req.url));
  return `${method}:${pathStr}`;
}

function flattenItems(items, folderPath = [], skipMobile = false) {
  const out = [];
  for (const item of items || []) {
    if (skipMobile && item.name === 'Mobile') continue;
    if (item.request) {
      out.push({
        item: structuredClone(item),
        folderPath,
      });
    }
    if (item.item) {
      const inMobile = skipMobile || folderPath[0] === 'Mobile';
      out.push(...flattenItems(item.item, [...folderPath, item.name], inMobile));
    }
  }
  return out;
}

function classifyPartner(pathNorm) {
  if (pathNorm.includes('/api/mobile/partner/subscription')) return 'partner_subscription_mobile';
  if (pathNorm.includes('/api/mobile/partner')) return 'register';
  if (pathNorm.includes('/api/partner_service')) return 'partner_service';
  if (pathNorm.includes('/api/partner_category')) return 'partner_category';
  if (pathNorm.includes('/api/partner_document')) return 'partner_document';
  if (pathNorm.includes('/api/partner-subscription')) return 'partner_subscription';
  if (pathNorm.includes('/api/partner_payout')) return 'partner_payout';
  if (pathNorm.includes('/api/bank_account')) return 'bank_account';
  if (pathNorm.includes('/api/user/register-partner')) return 'legacy_register';
  if (pathNorm.includes('/api/user/')) return 'profile';
  if (pathNorm.match(/\/api\/auth\/(login|logout|forgotpassword)/)) return 'auth';
  if (pathNorm.includes('/api/address')) return 'address';
  if (pathNorm.includes('/api/state')) return 'location';
  if (pathNorm.includes('/api/city')) return 'location';
  if (pathNorm.includes('/api/area')) return 'location';
  if (pathNorm.includes('/api/document_upload') || pathNorm.includes('/api/document')) return 'documents';
  if (pathNorm.includes('/api/notification_settings')) return 'notifications';
  if (pathNorm.includes('/api/subscription-plan')) return 'subscription_plan';
  if (
    pathNorm.includes('/api/order') ||
    pathNorm.includes('/api/quote') ||
    pathNorm.includes('/api/order_service') ||
    pathNorm.includes('/api/order-additional-charges') ||
    pathNorm.includes('/api/order-payments')
  ) {
    return 'orders';
  }
  if (pathNorm.includes('/api/chat')) return 'chat';
  if (pathNorm.includes('/api/category') || pathNorm.includes('/api/service')) return 'catalog';
  if (pathNorm.includes('/api/franchise')) return 'franchise';
  if (pathNorm.includes('/api/offer')) return 'offers';
  return null;
}

function classifyUser(pathNorm) {
  if (pathNorm.includes('/api/mobile/user')) return 'register';
  if (pathNorm.includes('/api/auth/userlogin')) return 'auth';
  if (pathNorm.includes('/api/user_home_counts')) return 'home';
  if (pathNorm.includes('/api/razorpay')) return 'payments';
  if (pathNorm.match(/\/api\/auth\/(login|logout|forgotpassword)/)) return 'auth';
  if (pathNorm.includes('/api/address')) return 'address';
  if (pathNorm.includes('/api/state') || pathNorm.includes('/api/city') || pathNorm.includes('/api/area')) {
    return 'location';
  }
  if (
    pathNorm.includes('/api/order') ||
    pathNorm.includes('/api/quote') ||
    pathNorm.includes('/api/order_service')
  ) {
    return 'orders';
  }
  if (pathNorm.includes('/api/user/')) return 'profile';
  if (pathNorm.includes('/api/notification_settings')) return 'notifications';
  if (pathNorm.includes('/api/chat')) return 'chat';
  if (pathNorm.includes('/api/ticket')) return 'support';
  return null;
}

const PARTNER_FOLDER_LABELS = {
  register: '01 — Register (mobile app)',
  auth: '02 — Auth',
  profile: '03 — Profile & user',
  location: '04 — State / City / Area',
  catalog: '05 — Category & service (catalog)',
  partner_category: '06 — Partner categories',
  partner_service: '07 — Partner services',
  documents: '08 — Documents',
  bank_account: '09 — Bank account',
  partner_subscription: '10 — Partner subscription (admin)',
  partner_subscription_mobile: '10b — Subscription upgrade / downgrade',
  subscription_plan: '11 — Subscription plans',
  address: '12 — Address',
  orders: '13 — Orders & quotes',
  partner_payout: '14 — Partner payout (wallet)',
  notifications: '15 — Notification settings',
  chat: '16 — Chat',
  franchise: '17 — Franchise',
  offers: '18 — Offers',
  legacy_register: '99 — Legacy register-partner (full form)',
};

/** Partner mobile auth routes (flat items under Help-PR-Mobile-APIs → Partner; excludes /register). */
const MOBILE_PARTNER_AUTH_PATH_SUFFIXES = [
  '/api/mobile/partner/login',
  '/api/mobile/partner/google-login',
  '/api/mobile/partner/apple-login',
  '/api/mobile/partner/forgot-password',
  '/api/mobile/partner/verify-forgot-password-otp',
  '/api/mobile/partner/reset-password',
];

/** Customer mobile auth routes (flat items under Help-PR-Mobile-APIs → User). */
const MOBILE_USER_AUTH_PATH_SUFFIXES = [
  '/api/mobile/user/login',
  '/api/mobile/user/verify-otp',
  '/api/mobile/user/google-login',
  '/api/mobile/user/apple-login',
  '/api/mobile/user/forgot-password',
  '/api/mobile/user/verify-forgot-password-otp',
  '/api/mobile/user/reset-password',
];

const MOBILE_USER_COLLECTION_VAR_KEYS = [
  'customerPhone',
  'customerOtp',
  'googleIdToken',
  'deviceToken',
  'customerToken',
  'customerId',
  'customerEmail',
  'customerName',
  'passwordResetOtp',
  'passwordResetToken',
];

const USER_FOLDER_LABELS = {
  register: '01 — Register (mobile app)',
  auth: '02 — Auth',
  profile: '03 — Profile & user',
  location: '04 — State / City / Area',
  address: '05 — Address',
  home: '06 — Home counts',
  orders: '07 — Orders & quotes',
  payments: '08 — Razorpay',
  notifications: '09 — Notification settings',
  chat: '10 — Chat',
  support: '11 — Tickets',
};

function mobileRegisterPartnerRequest() {
  return {
    name: 'Register partner (mobile app)',
    event: [
      {
        listen: 'test',
        script: {
          exec: [
            'try {',
            '  const j = pm.response.json();',
            '  const t = j?.token || j?.auth_token || j?.record?.auth_token;',
            '  if (t) {',
            "    pm.collectionVariables.set('token', t);",
            "    pm.collectionVariables.set('accessToken', t);",
            '  }',
            '  if (j?.record?._id) {',
            "    pm.collectionVariables.set('partnerId', String(j.record._id));",
            "    pm.collectionVariables.set('userId', String(j.record._id));",
            '  }',
            '} catch (e) {}',
          ],
          type: 'text/javascript',
        },
      },
    ],
    request: {
      auth: { type: 'noauth' },
      method: 'POST',
      header: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'Accept', value: 'application/json' },
      ],
      body: {
        mode: 'raw',
        raw: JSON.stringify(
          {
            name: 'Ravi Kumar',
            date_of_birth: '1995-06-15',
            phone_number: '+919876543210',
            email: `partner.mobile+${Date.now()}@example.com`,
            password: '123456',
          },
          null,
          2
        ),
        options: { raw: { language: 'json' } },
      },
      url: {
        raw: '{{baseUrl}}/api/mobile/partner/register',
        host: ['{{baseUrl}}'],
        path: ['api', 'mobile', 'partner', 'register'],
      },
      description:
        '**POST /api/mobile/partner/register** — Partner mobile signup (5 fields). No JWT. Returns `token` + `record`. Use Bearer token for onboarding APIs in this folder.',
    },
  };
}

function buildGroupedFolder(labels, itemsByGroup, order) {
  const folderItems = [];
  for (const key of order) {
    const list = itemsByGroup[key];
    if (!list || list.length === 0) continue;
    list.sort((a, b) => a.item.name.localeCompare(b.item.name));
    folderItems.push({
      name: labels[key] || key,
      description: `**${list.length}** request(s)`,
      item: list.map((x) => x.item),
    });
  }
  return folderItems;
}

function dedupeEntries(entries) {
  const seen = new Map();
  const out = [];
  for (const e of entries) {
    const key = getRequestKey(e.item.request);
    if (seen.has(key)) continue;
    seen.set(key, true);
    out.push(e);
  }
  return out;
}

function collectFolderRequests(folder) {
  const out = [];
  for (const entry of folder.item || []) {
    if (entry.request) out.push(entry.request);
    if (entry.item) out.push(...collectFolderRequests(entry));
  }
  return out;
}

function folderHasMobilePath(folder, segment) {
  return collectFolderRequests(folder).some((req) =>
    normalizePath(urlToPathString(req.url)).includes(segment)
  );
}

function isMobileAuthPath(pathNorm, pathSuffixes) {
  return pathSuffixes.some((suffix) => pathNorm === suffix || pathNorm.endsWith(suffix));
}

function mobileAuthSortIndex(req, pathSuffixes) {
  const pathNorm = normalizePath(urlToPathString(req?.url));
  const idx = pathSuffixes.findIndex((suffix) => pathNorm.endsWith(suffix));
  return idx === -1 ? 999 : idx;
}

/** Flat auth requests from Help-PR-Mobile-APIs (Login, Google login, forgot password, …). */
function extractMobileAuthRequests(rootName, pathSuffixes) {
  if (!fs.existsSync(MOBILE_ONLY_FILE)) return [];

  const mobileOnly = JSON.parse(fs.readFileSync(MOBILE_ONLY_FILE, 'utf8'));
  const root = (mobileOnly.item || []).find((i) => i.name === rootName);
  if (!root?.item?.length) return [];

  return root.item
    .filter(
      (entry) =>
        entry.request &&
        isMobileAuthPath(normalizePath(urlToPathString(entry.request.url)), pathSuffixes)
    )
    .map((entry) => structuredClone(entry))
    .sort((a, b) => {
      const orderDiff =
        mobileAuthSortIndex(a.request, pathSuffixes) -
        mobileAuthSortIndex(b.request, pathSuffixes);
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });
}

function mergeMobileAuthRequests(folders, authFolderName, rootName, pathSuffixes) {
  const authRequests = extractMobileAuthRequests(rootName, pathSuffixes);
  if (!authRequests.length) return folders;

  const foldersOut = [...folders];
  let authIdx = foldersOut.findIndex((folder) => folder.name === authFolderName);

  if (authIdx === -1) {
    foldersOut.unshift({
      name: authFolderName,
      description: `**${authRequests.length}** request(s)`,
      item: [],
    });
    authIdx = 0;
  }

  const authFolder = foldersOut[authIdx];
  const seen = new Set((authFolder.item || []).map((entry) => getRequestKey(entry.request)));

  for (const entry of authRequests) {
    const key = getRequestKey(entry.request);
    if (seen.has(key)) continue;
    seen.add(key);
    authFolder.item.push(entry);
  }

  authFolder.item.sort((a, b) => {
    const orderDiff =
      mobileAuthSortIndex(a.request, pathSuffixes) -
      mobileAuthSortIndex(b.request, pathSuffixes);
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name);
  });
  authFolder.description = `**${authFolder.item.length}** request(s)`;
  foldersOut[authIdx] = authFolder;

  return foldersOut;
}

function mergeMobileUserAuthRequests(folders) {
  return mergeMobileAuthRequests(
    folders,
    USER_FOLDER_LABELS.auth,
    'User',
    MOBILE_USER_AUTH_PATH_SUFFIXES
  );
}

function mergeMobilePartnerAuthRequests(folders) {
  return mergeMobileAuthRequests(
    folders,
    PARTNER_FOLDER_LABELS.auth,
    'Partner',
    MOBILE_PARTNER_AUTH_PATH_SUFFIXES
  );
}

function syncMobileCollectionVariables(collection) {
  if (!fs.existsSync(MOBILE_ONLY_FILE)) return;

  const mobileOnly = JSON.parse(fs.readFileSync(MOBILE_ONLY_FILE, 'utf8'));
  const mobileVars = mobileOnly.variable || [];
  if (!collection.variable) collection.variable = [];

  const keys = new Set(collection.variable.map((variable) => variable.key));

  for (const key of MOBILE_USER_COLLECTION_VAR_KEYS) {
    if (keys.has(key)) continue;
    const found = mobileVars.find((variable) => variable.key === key);
    if (found) {
      collection.variable.push(structuredClone(found));
      keys.add(key);
    }
  }
}

/** Folders from Help-PR-Mobile-APIs override generated groups for dedicated mobile routes. */
function mergeMobileOnlyFolders(builtFolders, rootName, pathSegment) {
  if (!fs.existsSync(MOBILE_ONLY_FILE)) return builtFolders;

  const mobileOnly = JSON.parse(fs.readFileSync(MOBILE_ONLY_FILE, 'utf8'));
  const root = (mobileOnly.item || []).find((i) => i.name === rootName);
  if (!root?.item?.length) return builtFolders;

  const mobileFolders = root.item.filter((folder) =>
    folderHasMobilePath(folder, pathSegment)
  );
  if (!mobileFolders.length) return builtFolders;

  const byName = new Map(builtFolders.map((folder) => [folder.name, folder]));
  for (const folder of mobileFolders) {
    byName.set(folder.name, structuredClone(folder));
  }
  return Array.from(byName.values());
}

function main() {
  const collection = JSON.parse(fs.readFileSync(COLLECTION_FILE, 'utf8'));
  const flat = flattenItems(collection.item, [], true);

  const partnerEntries = [];
  const userEntries = [];

  for (const entry of flat) {
    const pathNorm = normalizePath(urlToPathString(entry.item.request.url));
    if (!pathNorm.includes('/api/')) continue;

    const pGroup = classifyPartner(pathNorm);
    const uGroup = classifyUser(pathNorm);

    if (pGroup) partnerEntries.push({ ...entry, group: pGroup });
    if (uGroup && !pGroup) userEntries.push({ ...entry, group: uGroup });
    else if (uGroup && pGroup && uGroup !== pGroup) {
      if (['auth', 'location', 'address', 'orders', 'notifications', 'chat', 'profile'].includes(uGroup)) {
        userEntries.push({ ...entry, group: uGroup });
      }
    }
  }

  const partnerDeduped = dedupeEntries(partnerEntries);
  const userDeduped = dedupeEntries(userEntries);

  const partnerByGroup = {};
  for (const e of partnerDeduped) {
    if (!partnerByGroup[e.group]) partnerByGroup[e.group] = [];
    partnerByGroup[e.group].push(e);
  }

  const userByGroup = {};
  for (const e of userDeduped) {
    if (!userByGroup[e.group]) userByGroup[e.group] = [];
    userByGroup[e.group].push(e);
  }

  partnerByGroup.register = [{ item: mobileRegisterPartnerRequest() }];

  const partnerOrder = [
    'register',
    'auth',
    'profile',
    'location',
    'catalog',
    'partner_category',
    'partner_service',
    'documents',
    'bank_account',
    'partner_subscription',
    'partner_subscription_mobile',
    'subscription_plan',
    'address',
    'orders',
    'partner_payout',
    'notifications',
    'chat',
    'franchise',
    'offers',
    'legacy_register',
  ];

  const userOrder = [
    'register',
    'auth',
    'profile',
    'location',
    'address',
    'home',
    'orders',
    'payments',
    'notifications',
    'chat',
    'support',
  ];

  const partnerFolder = {
    name: 'Partner',
    description:
      '**Partner mobile app** — **01 → Register** or **02 — Auth → Google login** / **Apple login** / **Login**. Then `Bearer {{token}}` for onboarding. Email/password **Login** also works via `/api/auth/login` after admin sets `is_active: true`.',
    item: mergeMobilePartnerAuthRequests(
      mergeMobileOnlyFolders(
        buildGroupedFolder(PARTNER_FOLDER_LABELS, partnerByGroup, partnerOrder),
        'Partner',
        '/api/mobile/partner'
      )
    ),
  };

  const userFolder = {
    name: 'User',
    description:
      '**Customer / end-user mobile app** — **02 — Auth**: phone OTP (`/login` → `/verify-otp`), **Google login** (`/google-login`), or **Apple login** (`/apple-login`). Then home, orders, addresses, quotes, profile. Regenerated from `Help-PR-Mobile-APIs.postman_collection.json`.',
    item: mergeMobileUserAuthRequests(
      mergeMobileOnlyFolders(
        buildGroupedFolder(USER_FOLDER_LABELS, userByGroup, userOrder),
        'User',
        '/api/mobile/user'
      )
    ),
  };

  if (!userFolder.item.length) {
    userFolder.item = [
      {
        name: '00 — Placeholder',
        description: 'Add `/api/mobile/user/*` routes when the customer app APIs are implemented.',
        item: [],
      },
    ];
  }

  const mobileFolder = {
    name: 'Mobile',
    description:
      '**Mobile apps** — **Partner** (service provider) and **User** (customer). Set `{{baseUrl}}`. Regenerated via `node postman/build-mobile-folder.mjs`.',
    item: [partnerFolder, userFolder],
  };

  collection.item = collection.item.filter((i) => i.name !== 'Mobile');
  collection.item.push(mobileFolder);

  syncMobileCollectionVariables(collection);

  collection.info.description =
    (collection.info.description || '').split('\n\n**Mobile:**')[0] +
    '\n\n**Mobile:** folder **Mobile → Partner** / **Mobile → User** — run `node postman/build-mobile-folder.mjs` to refresh.';

  fs.writeFileSync(COLLECTION_FILE, JSON.stringify(collection, null, 2), 'utf8');
  const partnerCount = partnerDeduped.length + 1;
  const userCount = userDeduped.length;
  console.log(`Updated ${COLLECTION_FILE}`);
  console.log(`  Mobile → Partner: ${partnerCount} requests in ${partnerFolder.item.length} subfolders`);
  console.log(`  Mobile → User: ${userCount} requests in ${userFolder.item.length} subfolders`);
}

main();
