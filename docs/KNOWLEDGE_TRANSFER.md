# Help PR Backend — Knowledge Transfer

This document is a walkthrough of **help-pr-backend-staging**: how web vs mobile APIs are split, who the users are, what each module does, how notifications and chat work, and which third-party integrations the env vars imply.

Use it as a KT script. Deeper field-level contracts live in the module docs listed at the end.

---

## 1. What this product is

Help PR is a **franchise-based home-services marketplace**.

```text
Super Admin / Staff          Global platform
        │                    geography, catalog, franchises, offers, plans
        ▼
Franchise Admin / Employee   One territory
        │                    partners, customers, quotes, orders, verification
        ├──────────────────┐
        ▼                  ▼
     Partner            Customer
  (type 2)             (type 4)
  does the job         books & pays
```

This repo is the **business API** (auth, catalog, quotes, orders, payments, notifications inbox). It runs as:

| Runtime | When | Entry |
|---------|------|--------|
| **AWS Lambda** | Staging / production | `exports.handler` in `server.js` (API Gateway → `aws-serverless-express`) |
| **Local / VM** | Dev | HTTP on `PORT` (default `5001`) |

**Chat is not in this process.** Realtime chat lives on a separate **Chat Service** (VPS). This backend only *provisions* chats over HTTP after orders/disputes are saved.

---

## 2. How a request is handled

```text
HTTP
  → routes/            path + middleware chain
  → middleware/        JWT, role, validation, franchise scope
  → controllers/       request / response
  → services/          business logic
  → models/            MongoDB (Mongoose)
```

Mount point is `server.js`. Almost everything is under `/api/...`.

Typical JSON envelope:

```json
{
  "success": true,
  "status": 200,
  "message": "...",
  "record": {},
  "records": []
}
```

Auth is `Authorization: Bearer <JWT>`. All tokens are signed with the same `JWT_SECRET`. Payload includes at least `id` and `type`. Most permission checks **reload the user from MongoDB** rather than trusting the JWT alone.

---

## 3. User types

Defined on `user.type` (`models/user.js`, labels in `enum/user_type_enum.js`, constants in `constants/user_types.js`).

| `type` | Name | Typical client | Login |
|--------|------|----------------|-------|
| **1** | Franchise Admin | Web back-office | Email / password |
| **2** | Partner | Partner mobile + some web APIs | Email / password, phone OTP, Google, Apple |
| **3** | Employee | Web back-office | Email / password |
| **4** | Customer | Customer mobile | Phone OTP, Google, Apple |
| **5** | Super Admin | Global admin web | Email / password |
| **6** | Staff | Platform ops web (`accessible_screens`) | Email / password |

**Back-office roles** = types **1, 3, 5, 6** (`BACKOFFICE_TYPES`). Partner (2) and Customer (4) are **not** back-office.

Important user fields:

| Field | Meaning |
|-------|---------|
| `franchise_id` | Ties admin / employee / partner to a franchise |
| `is_active` | Must be true for web email login |
| `verification_status` | Partners: `1` Pending, `2` Verified, `3` Rejected |
| `registration_type` | How the account was created (see below) |
| `device_token` / `user_device_token` | FCM tokens for push |
| `accessible_screens` | Optional page permissions for Staff |
| `deleted_at` | Soft delete — lists filter `deleted_at: null` |

`registration_type` (set at create, not overwritten later):

| Value | Meaning |
|-------|---------|
| 1 | Mobile OTP |
| 2 | Google sign-in |
| 3 | Apple sign-in |
| 4 | Admin registered (`POST /api/user/create`) |
| 5 | Email + password (partner register) |

### Who can create whom (`POST /api/user/create`)

| Creator | Allowed target types |
|---------|----------------------|
| Super Admin (5), Staff (6) | All (1–6) |
| Franchise Admin (1), Employee (3) | Partner (2), Employee (3), Customer (4) — **own franchise only** |
| Partner (2), Customer (4) | Not allowed |

### Franchise isolation

- Super Admin / Staff: all franchises; optional `franchise_id` filter.
- Franchise Admin / Employee: only their `franchise_id`.
- Partner / Customer: **403** on back-office list endpoints (`getAll` for orders, quotes, refunds).

Implemented in `utils/franchise_scope_access.js` and related helpers.

### Role middleware (`middleware/role_middleware.js`)

| Middleware | Allows |
|------------|--------|
| `authMiddleware` | Any valid JWT |
| `requireBackoffice` | Types 1, 3, 5, 6 |
| `requirePartner` | Type 2 |
| `requireSuperAdmin` | Type 5 |
| `requireSuperAdminOrStaff` | Types 5, 6 |
| `authorizeUserCreate` | Create-user rules above |

---

## 4. Web vs mobile — how routes are split

There are **two API surfaces**, both served by this same Express app.

```text
                    server.js
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
  /api/<module>                    /api/mobile/...
  Web / back-office                Mobile apps
  (and some shared APIs)           Customer + Partner
```

They are **not** the same controllers with a query flag. Mobile has its own route trees, middleware, and often its own services under `services/mobile/` and `controllers/mobile/`.

### 4.1 Web / back-office (`/api/...`)

Mounted in `server.js`. Used by the **admin web dashboard** (and some partner web screens). JWT is validated by `middleware/auth_middleware.js` — it does **not** check `user.type`; each route adds `requireBackoffice`, `requirePartner`, etc.

| Prefix | Module |
|--------|--------|
| `/api/auth` | Email login, logout, forgot password, legacy `userLogin` |
| `/api/otp` | Legacy customer phone OTP |
| `/api/user` | User CRUD, partner register, verification |
| `/api/state`, `/city`, `/area` | Geography |
| `/api/franchise`, `/franchise-category`, `/franchise-service` | Franchises + franchise catalog |
| `/api/category`, `/service` | Global catalog |
| `/api/partner_category`, `/partner_service`, `/partner_document` | Partner catalog / docs (web) |
| `/api/document`, `/document_upload` | Documents + file uploads (including chat attachments) |
| `/api/bank_account` | Partner bank accounts |
| `/api/subscription-plan`, `/partner-subscription` | Plans and partner subscriptions |
| `/api/offer`, `/tax`, `/quote_settings` | Offers, tax, quote config |
| `/api/quote` | Quotes (back-office) |
| `/api/order`, `/order_service`, `/order-additional-charges`, `/order-payments` | Orders and money |
| `/api/appointment` | Appointments |
| `/api/address` | Addresses |
| `/api/ticket`, `/dispute` | Support tickets and disputes |
| `/api/razorpay` | Payment gateway (webhook is registered **before** `express.json`) |
| `/api/refund`, `/partner_payout` | Refunds and partner payouts |
| `/api/dashboard`, `/export` | Stats and Excel exports |
| `/api/notification_settings`, `/api/notifications` | Settings + **in-app inbox** (back-office) |
| `/api/notification` | Gated FCM test send |
| `/api/content-management` | CMS pages |
| `/api/expense-category-management`, `/expense-management` | Expenses |
| `/api/partner-post`, `/partners` | Partner portfolio posts + partner listing |
| `/api/user_home_counts` | Home counters |
| `/api` (count routes) | Various counts |

Public / special (not under a JWT module):

| Path | Purpose |
|------|---------|
| `POST /api/razorpay/razorpayWebhook` | Razorpay HMAC webhook (raw body) |
| `GET/POST /api/whatsapp/webhook` | WhatsApp Cloud API webhook |
| `GET /health` | Health check |
| `/.well-known`, `/apple-app-site-association` | Android App Links / iOS Universal Links |
| `/post/:postId` | Public post-share landing |

### 4.2 Mobile (`/api/mobile/...`)

Mounted as `app.use('/api/mobile', mobileRoutes)` → `routes/mobile/index.js`.

```text
/api/mobile
  ├── (common, no auth)  /states /cities /areas /pincodes
  ├── /partner/...       Partner app  (type 2 JWT)
  └── /user/...          Customer app (type 4 JWT)
```

Rate limiters: common, partner, and user (`middleware/mobile/...`).

**Customer JWT guard** (`user_auth_middleware.js`): token must have `type === 4`. A partner token on a customer route gets **403**.

**Partner JWT guard** (`partner_auth_middleware.js`): valid JWT; most partner business routes also use `requirePartnerAccount`.

### Customer mobile (`/api/mobile/user`)

| Area | Examples |
|------|----------|
| Auth | `POST /login` (send OTP), `/verify-otp`, `/google-login`, `/apple-login`, forgot/reset password, `/logout`, `DELETE /delete` |
| Profile | `PUT /update`, `GET /pincodes` |
| Home | `GET /home` |
| Addresses | `/addresses/get`, create / update / delete |
| Quotes | `/quotes/create`, list, get, update, cancel, `convert-to-order` |
| Orders | `/orders`, invoice, payments, review |
| Partners | list, save/unsave, profile, ratings |
| Posts | feed, like, save, share, report |
| Disputes | `POST/GET /disputes` |
| Support chat start | `POST /chats/support` (proxied to Chat Service) |
| Notifications | `/notifications` inbox |

### Partner mobile (`/api/mobile/partner`)

| Area | Examples |
|------|----------|
| Auth | `/register`, `/login`, `/phone-login`, `/verify-otp`, Google/Apple, forgot/reset, `/logout`, `DELETE /delete` |
| Profile | `PUT /update` (multipart: photo + verification docs) |
| Home / ratings | `GET /home`, `GET /ratings` |
| Catalog | `GET /categories`, `/my-services` (list / bulk update / status) |
| Bank | `/bank-accounts/...` |
| Subscription | `/subscription-plans`, `/subscription`, plan change |
| Quotes | `GET /quotes`, `PUT /quotes/:id/status` (accept / reject) |
| Orders | list, details, `work-status`, `complete` (proof images), additional charges, invoice |
| Appointments | `/appointments` |
| Wallet | `/wallet`, `/wallet/transactions`, `/financial-payments` |
| Posts | create / list / update / delete own posts; video via Bunny TUS session |
| Notifications | `/notifications` inbox |

Partner **writes** to catalog, bank, and my-services are gated by `verification_status === 2` (Verified). Rejected partners can still log in.

### 4.3 Why two surfaces exist

| Concern | Web `/api/...` | Mobile `/api/mobile/...` |
|---------|----------------|--------------------------|
| Audience | Dashboard users | Flutter apps |
| Auth middleware | Generic JWT | Typed (customer vs partner) |
| Payload shape | Admin forms, filters, franchise scope | App-oriented home, feeds, work status |
| Push | Not sent (in-app only) | FCM to device tokens |
| Chat REST | Clients call **Chat Service** directly | Disputes on Lambda; messaging on Chat Service |

Same JWT secret, so a token issued on mobile works on Chat Service (and vice versa).

---

## 5. Modules (business domains)

### 5.1 Geography and franchise

States → cities → areas → pincodes. A **franchise** owns a set of cities(and it's areas) and an admin user. Almost all operational data (`quote`, `order`, `partner`) is scoped by `franchise_id`.

### 5.2 Catalog (three layers)

```text
Global          Franchise                 Partner
/api/category   /api/franchise-category   /api/partner_category
/api/service    /api/franchise-service    /api/partner_service
                                          /api/mobile/partner/my-services
```

- **Global:** Super Admin / Staff. Franchise staff can *request* new services/categories; those go through an approval workflow (`utils/service_workflow.js`).
- **Franchise:** what that territory offers.
- **Partner:** what this partner actually sells and at what price (after verification).

### 5.3 Quotes

Statuses: `new` → `pending` → `accepted` → `success` | `failed`.

- Customer mobile create is always `new` (partner must not see it until admin confirms).
- Admin confirm / first partner assign → `pending` → partner notified (`QUOTE_ASSIGNED`) and a **1-hour action window** starts (`QUOTE_ACTION_DEADLINE_MINUTES`, default 60).
- Partner accepts → `accepted`. Customer or admin converts → `success` → **order is created automatically**.
- Quotes in `new` are hidden from the partner list.

### 5.4 Orders and money

Orders are created by:

1. Quote conversion (`createOrderFromQuote`), or
2. Back-office `POST /api/order/create` (types 1, 3, 5, 6 only).

Customers and partners **do not** create admin orders.

Statuses: `in-progress` (default) → `completed` | `cancelled` | `refunded`.

**Completion requires the customer to be fully paid** (`user_payment_status === paid`).

Pricing is computed server-side (commission, tax, discount, additional charges). Client totals are compared; **server values win**.

Payments: cash / UPI recorded as `order_payment` rows, or **Razorpay** online. Partner remittance is tracked separately (`partner_payment_status`, wallet ledger, payouts).

### 5.5 Appointments

Tied to orders. Created manually or automatically on order create. Partner mobile has its own appointment CRUD.

### 5.6 Partner onboarding

Register → pending verification → admin approves documents → partner configures services and bank → can accept jobs. Subscription plans can be assigned by admin or changed by the partner (self-service).

### 5.7 Partner posts (portfolio)

Partners publish posts; back-office approves / rejects / hides. Customers see a franchise feed, can like / save / share / report. Public share URLs use App Links (`POST_SHARE_WEB_BASE_URL`).

### 5.8 Tickets, disputes, refunds, expenses, CMS, exports

- **Tickets:** support tickets; status changes notify the creator.
- **Disputes:** customer raises on an eligible completed order; creates a 1:1 dispute chat on the Chat Service.
- **Refunds:** back-office only.
- **Expenses:** franchise expenses; Super Admin/Staff get in-app notice.
- **Content management:** legal / CMS pages.
- **Exports:** Excel downloads (`/api/export`); Lambda returns base64.

---

## 6. Notifications

One notification engine in `src/modules/notifications/`. Business code **must not** call Firebase directly. It calls `safeNotify*` hooks; those call `notify()`.

```text
Business action (order update, quote accept, cron, chat webhook)
        │
        ▼
domainHooks.js          ← mobile / partner / customer events (may push)
backofficeHooks.js      ← web inbox events (skipPush: true)
notificationReminder.service.js
        │
        ▼
notification.service.js   notify()
        │
        ├── MongoDB Notification  (in-app inbox for EVERY recipient)
        └── notificationPush.service.js
                  │
                  ├── skip if skipPush
                  ├── skip if recipient is back-office type
                  ├── check is_update_allow / is_reminder_allow
                  ├── load FCM tokens (user_device_token)
                  └── service/firebase/push_service.js
```

**Actor exclusion:** the user who performed the action is removed from recipients.

**Dedupe:** hooks pass `dedupeKeyPrefix`; one notification per recipient per key.

### 6.1 Two audiences (this is the important split)

| | **Push (mobile apps)** | **Back-office (web inbox)** |
|---|------------------------|-----------------------------|
| Recipients | Customer (4) and Partner (2) | Admin (1), Employee (3), Super Admin (5), Staff (6) |
| Delivery | In-app row **+ FCM** | In-app row **only** (`skipPush: true`) |
| Why no push for web? | — | `BACKOFFICE_TYPES` are skipped in `notificationPush.service.js` (`backoffice_user_no_mobile_push`) even if a token existed |
| Inbox API | `/api/mobile/user/notifications` and `/api/mobile/partner/notifications` | `/api/notifications` |
| Hook files | `domainHooks.js` | `backofficeHooks.js` |
| Category | `order`, `quote`, `subscription`, `wallet`, `ticket`, `chat`, `system`, `reminder` | Mostly `admin` |

Same `notify()` function. Back-office hooks wrap it as `notify({ ..., skipPush: true })`.

### 6.2 Inbox APIs (identical verbs, different base paths)

| Method | Path (relative to base) |
|--------|-------------------------|
| `GET /` | Paginated list (`page`, `limit`, `is_read`, `category`, `event`, `from_date`, `to_date`) |
| `GET /unread-count` | Unread count |
| `PUT /:id/read` | Mark one read |
| `PUT /read-all` | Mark all read |

Settings: `models/notification_settings.js`

| Field | Default | Used for |
|-------|---------|----------|
| `is_update_allow` | true | Real-time push |
| `is_reminder_allow` | true | Reminder push (RM1–RM4) |
| `is_sms_allow` | true | Unused (SMS stub) |

Device tokens: send `device_token` on every mobile login. Stored in `user_device_token` (multi-device). Stale FCM tokens are removed on send failure.

### 6.3 Firebase / FCM

Two Firebase projects (two apps):

| App | Credentials file | Target |
|-----|------------------|--------|
| Customer | `resources/adminsdk-customer.json` (fallback `adminsdk-user.json` / `adminsdk.json`) | `customer` |
| Partner | `resources/adminsdk-partner.json` (fallback `adminsdk.json`) | `partner` |

Code: `service/firebase/push_service.js`.

### 6.4 Mobile / partner event keys (push)

Defined in `src/modules/notifications/constants/notification_events.js`. Wired from business services via `domainHooks.js`.

**Orders:** created, status, cancelled, service assign/unassign/time/cancel, payment completed/received/failed, refund, additional charges, partner work started/completed, review.

**Quotes:** created, status, assigned.

**Subscriptions / wallet:** assigned, status, plan change, payment, credit/debit.

**Disputes / tickets / system:** dispute raised/status, ticket status, partner verification, partner post approved/rejected/hidden/removed.

**Appointments:** scheduled, status changed.

**Reminders (cron):**

| Code | Event | Default window |
|------|-------|----------------|
| RM1 | `SERVICE_REMINDER` | `SERVICE_REMINDER_LEAD_HOURS` (24) |
| RM2 | `QUOTE_ACTION_REMINDER` | `QUOTE_PENDING_REMINDER_HOURS` (48) |
| RM3 | `SUBSCRIPTION_EXPIRING_REMINDER` | `SUBSCRIPTION_EXPIRING_REMINDER_DAYS` (7) |
| RM4 | `QUOTE_DEADLINE_REMINDER` | 20 / 10 / 5 / 2 minutes left in the 1-hour window |

Cron:

- Production: EventBridge → `POST /api/notifications/cron/reminders` with header `x-cron-secret: <NOTIFICATION_CRON_SECRET>` (use **1 minute** so RM4 hits the 2-minute bucket).
- Local: `ENABLE_NOTIFICATION_REMINDER_CRON=true` starts a `setInterval` in `server.js`.
- CLI: `node scripts/run-notification-reminders.js`.

Quotes are **not** auto-failed when the hour ends; only reminders fire.

### 6.5 Back-office event keys (in-app only)

Recipients come from `resolvers/backofficeRecipients.js`:

- **Super Admin + Staff** — platform-wide events (catalog requests, expenses, new quotes/orders at platform level).
- **Franchise Admin + Employee** (same `franchise_id`) — franchise-scoped events.
- Combined where both need to know (partner pending, post pending, account deleted).

| Event | When | Typical recipients |
|-------|------|--------------------|
| `CATEGORY_REQUEST_SUBMITTED` / `SERVICE_REQUEST_SUBMITTED` | Franchise requests catalog item | Super Admin + Staff |
| `CATALOG_REQUEST_REVIEWED` | Approve / reject | Requester + franchise back-office |
| `PARTNER_PENDING_VERIFICATION` | Partner registers / pending | Super + franchise |
| `EMPLOYEE_ADDED` | Employee created | Super Admin + Staff |
| `EXPENSE_CREATED` | Expense recorded | Super Admin + Staff |
| `BACKOFFICE_QUOTE_CREATED` | Quote created | Super Admin + Staff |
| `BACKOFFICE_QUOTE_STATUS_CHANGED` | Partner accept/reject | Super Admin + Staff |
| `BACKOFFICE_ORDER_CREATED` / `_STATUS_CHANGED` | Order lifecycle | Super Admin + Staff |
| `BACKOFFICE_CUSTOMER_PAYMENT_RECEIVED` / `_PARTNER_PAYMENT_RECEIVED` | Payments | Super Admin + Staff |
| `BACKOFFICE_SUBSCRIPTION_CHANGED` | Partner plan change | Super Admin + Staff |
| `PARTNER_POST_PENDING_REVIEW` | Post submitted | Super + franchise |
| `PARTNER_ACCOUNT_DELETED` / `CUSTOMER_ACCOUNT_DELETED` | Self-delete | Super (+ franchise for partner) |
| `BACKOFFICE_CHAT_MESSAGE_RECEIVED` | Chat Service webhook | Franchise admin + employees |

Chat messages on web: Chat Service → `POST /api/notifications/webhooks/chat-message` with `x-webhook-secret: <CHAT_NOTIFICATION_WEBHOOK_SECRET>`. Lambda writes in-app rows for franchise back-office; it does **not** FCM them.

### 6.6 Delivery logs

Every `notify()` writes `notification_delivery_log` (disable with `NOTIFICATION_DELIVERY_LOG_ENABLED=false`).

Super Admin / Staff: `GET /api/notifications/delivery-logs`.

Useful `push_skip_reason` values: `no_device_token`, `firebase_not_configured`, `backoffice_user_no_mobile_push`, `settings_disabled`, `firebase_send_failed`, `dedupe_skipped`, `push_disabled_for_hook`.

Test FCM: `POST /api/notification/send` (admin JWT). Disabled in production unless `ALLOW_NOTIFICATION_TEST=true`.

---

## 7. Chat module

**Chat is present, but not as Express routes in this repo.** `src/modules/chat/` was removed. Clients talk to **help-pr-chat-service** on a VPS. This Lambda only:

1. HTTP-provisions chats after business records exist.
2. Proxies “start support chat” from customer mobile.
3. Receives a webhook so back-office gets an in-app “new message” row.

```text
Customer / Partner / Admin apps
        │
        ├── business APIs  →  this Lambda  (/api/order, /api/quote, …)
        └── chat REST + Socket.IO  →  Chat Service (VPS)
                                        │
                    Lambda ──POST /internal/chats/*──► VPS
                    VPS ────POST /api/notifications/webhooks/chat-message──► Lambda
```

Enabled only when **all** of these are set:

- `CHAT_SERVICE_ENABLED=true`
- `CHAT_SERVICE_BASE_URL`
- `CHAT_SERVICE_INTERNAL_API_KEY`

Client: `services/chat_service_client.js`. Wrapper: `services/chat_integration.js`.

### Chat types

| Type | Participants | Created when |
|------|--------------|--------------|
| **Order** (`order`) | Customer, partner(s), assigned employee, franchise admin | Automatically after order create (`POST /internal/chats/order`). Synced on order update (`/internal/chats/order/sync`). `order.chat_id` stored here. |
| **Dispute** (`dispute`) | Customer + one handler (1:1) | Customer raises dispute (`POST /api/mobile/user/disputes` or back-office). Lambda creates dispute row, then `POST /internal/chats/dispute`. Status changes → `/internal/chats/dispute-status`. |
| **Support** (`support`) | Customer + one handler (1:1) | Customer `POST /api/mobile/user/chats/support` — Lambda **forwards the customer JWT** to Chat Service. |

### What this backend still owns vs Chat Service

| This Lambda | Chat Service (VPS) |
|-------------|-------------------|
| Orders, users, disputes records | Chat documents, messages, read tracking |
| Provision / sync via internal HTTP | REST `/api/chat`, Socket.IO |
| File **upload** (`/api/document_upload/files`, type `chat_attachment`) | Message metadata pointing at those URLs |
| Back-office in-app “new chat message” via webhook | FCM for **chat messages** to offline mobile users |
| Same `JWT_SECRET` and shared MongoDB | Only Chat Service **writes** chat collections |

Internal calls use header `X-Internal-Api-Key`. Timeouts: `CHAT_SERVICE_TIMEOUT_MS` (default 10000).

Chat attachments are uploaded to **this** API, not to the VPS.

If chat env is missing, order/dispute still succeed; chat provisioning is skipped and logged.

Frontend protocol (sockets, inbox by role, read vs write): `docs/CHAT_MODULE_FRONTEND.md`. Architecture: `docs/CHAT_SERVICE_ARCHITECTURE.md`.

---

## 8. Integrations (from env vars)

There is no committed `.env` in the repo. Names below are what the code actually reads.

### Core

| Variable | Purpose |
|----------|---------|
| `PORT` | Local HTTP port (default 5001) |
| `NODE_ENV` | `production` vs development (static catch-all, S3 vs local images, export encoding) |
| `MONGO_URI` | MongoDB (`MONGODB_URI` / `DB_URL` used by some scripts) |
| `JWT_SECRET` | All JWTs (this API + Chat Service must match) |
| `AWS_LAMBDA_FUNCTION_NAME` | If set, do not start the local HTTP server |

### AWS S3 / images

| Variable | Purpose |
|----------|---------|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | S3 client (non-production path in uploader) |
| `AWS_S3_BUCKET` | Upload bucket |
| `LOCAL_IMAGE_DIR` | Local disk when not using S3 |
| `IMAGE_CDN_BASE_URL` / `CDN_BASE_URL` | Turn stored keys into public URLs in JSON responses |

### Payments — Razorpay

| Variable | Purpose |
|----------|---------|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Create orders / verify payments |
| `RAZORPAY_WEBHOOK_SECRET` | HMAC on `POST /api/razorpay/razorpayWebhook` |
| `RAZORPAY_BASE_URL` | Public URL Razorpay can reach (callbacks) |

Code: `src/modules/payments/`.

### Bunny Stream (partner post videos)

| Variable | Purpose |
|----------|---------|
| `BUNNY_STREAM_LIBRARY_ID` | Stream library id |
| `BUNNY_STREAM_API_KEY` | Library write key — **server only**, never returned to Flutter |
| `BUNNY_STREAM_PULL_ZONE` | Pull-zone host, e.g. `vz-xxxx.b-cdn.net` |
| `BUNNY_STREAM_WEBHOOK_SECRET` | HMAC secret for `POST /api/webhooks/bunny-stream` (library read-only API key) |

Set the library webhook URL in the Bunny dashboard to `{API_BASE}/api/webhooks/bunny-stream`.

### WhatsApp Cloud API (OTP)

| Variable | Purpose |
|----------|---------|
| `WHATSAPP_ENABLED` | Master switch (`true` to send) |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | Graph API |
| `WHATSAPP_API_VERSION` | Default `v22.0` |
| `WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_OTP_TEMPLATE_LANGUAGE` | OTP template |
| `WHATSAPP_OTP_EXPIRY_MINUTES` | Default 10 |
| `WHATSAPP_OTP_INCLUDE_COPY_BUTTON` | Template copy button |
| `WHATSAPP_OTP_DEV_FALLBACK` | Dev: skip real send |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Webhook verify + signature |
| `WHATSAPP_WEBHOOK_SKIP_SIGNATURE_VERIFY` | Dev only |

### Email (Nodemailer)

| Variable | Purpose |
|----------|---------|
| `EMAIL_USER`, `EMAIL_PASS` | SMTP auth (required to send) |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_SERVICE` | Hosted SMTP or Gmail |
| `EMAIL_OTP_DEV_FALLBACK` | Dev: skip real email OTP |

Used for password reset and similar.

### Google / Apple Sign-In

Customer app: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID_ANDROID`, `GOOGLE_CLIENT_ID_IOS`, `GOOGLE_CLIENT_ID_WEB`.

Partner app: `GOOGLE_CLIENT_ID_PARTNER`, `GOOGLE_CLIENT_ID_ANDROID_PARTNER`, `GOOGLE_CLIENT_ID_IOS_PARTNER`, `GOOGLE_CLIENT_ID_WEB_PARTNER`.

Customer Apple: `APPLE_CLIENT_ID`, `APPLE_CLIENT_ID_IOS`, `APPLE_CLIENT_ID_WEB`.

Partner Apple: `APPLE_CLIENT_ID_PARTNER`, `APPLE_CLIENT_ID_IOS_PARTNER`, `APPLE_CLIENT_ID_WEB_PARTNER`.

### Chat Service

| Variable | Purpose |
|----------|---------|
| `CHAT_SERVICE_ENABLED` | Must be `"true"` |
| `CHAT_SERVICE_BASE_URL` | VPS origin |
| `CHAT_SERVICE_INTERNAL_API_KEY` | Internal provision APIs |
| `CHAT_SERVICE_TIMEOUT_MS` | Default 10000 |
| `CHAT_NOTIFICATION_WEBHOOK_SECRET` | VPS → Lambda chat inbox webhook |

### Push / reminders

| Variable | Purpose |
|----------|---------|
| `NOTIFICATION_CRON_SECRET` | Protects reminder HTTP endpoint |
| `ENABLE_NOTIFICATION_REMINDER_CRON` | Local interval runner |
| `NOTIFICATION_REMINDER_CRON_INTERVAL_MS` | Default 60000 |
| `SERVICE_REMINDER_LEAD_HOURS`, `QUOTE_PENDING_REMINDER_HOURS`, `QUOTE_ACTION_DEADLINE_MINUTES`, `SUBSCRIPTION_EXPIRING_REMINDER_DAYS` | Reminder windows |
| `NOTIFICATION_DELIVERY_LOG_ENABLED` | Default on |
| `ALLOW_NOTIFICATION_TEST` | Enable test FCM in production |

Firebase credentials are **files**, not env: `resources/adminsdk-customer.json` and `resources/adminsdk-partner.json`.

### App Links / post share

| Variable | Purpose |
|----------|---------|
| `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_CERT_FINGERPRINTS` | Digital Asset Links |
| `IOS_TEAM_ID`, `IOS_BUNDLE_ID` | Apple App Site Association |
| `POST_SHARE_WEB_BASE_URL` / `MOBILE_APP_SHARE_WEB_BASE` | Public post share URLs |

### Integration map

```text
Clients
  Web dashboard ────────┐
  Customer app ─────────┼──► Lambda (this repo) ──► MongoDB
  Partner app ──────────┘         │
                                  ├── AWS S3 (+ CDN URLs)
                                  ├── Razorpay
                                  ├── WhatsApp Cloud API
                                  ├── SMTP / Gmail
                                  ├── Google / Apple token verify
                                  ├── Firebase FCM (customer + partner projects)
                                  └── HTTP ──► Chat Service (VPS, Socket.IO + FCM for chat)
```

---

## 9. Authentication cheat sheet

| Who | How | Endpoints |
|-----|-----|-----------|
| Super Admin, Staff, Franchise Admin, Employee, Partner (web) | Email + password | `POST /api/auth/login` |
| Customer (legacy web/OTP) | Phone OTP | `POST /api/otp/send_otp` → `/verify_otp` |
| Customer mobile | OTP / Google / Apple | `POST /api/mobile/user/login` → `/verify-otp`; `/google-login`; `/apple-login` |
| Partner mobile | Email, phone OTP, Google, Apple | `POST /api/mobile/partner/login`, `/phone-login` + `/verify-otp`, `/google-login`, `/apple-login`, `/register` |
| Public partner signup (web) | Multipart, no JWT | `POST /api/user/register-partner` |

Logout: `POST /api/auth/logout` or mobile `/logout`. Forgot password uses email OTP (SMTP).

---

## 10. Quote → order → cash (one diagram)

```text
Create quote (customer app always "new", or back-office)
        │
        ▼
Admin confirms → pending → partner notified (1-hour window)
        │
        ▼
Partner accepts → accepted
        │
        ▼
Convert → success → Order + order_service (+ order chat provisioned)
        │
        ├── Customer payments (cash / Razorpay)
        ├── Additional charges
        ├── Partner work start / complete
        └── Partner payout / wallet
                │
                ▼
         completed (only if fully paid)
```

---

## 11. Where to look in the codebase

| Topic | Path |
|-------|------|
| App bootstrap / route mount | `server.js` |
| User type labels | `enum/user_type_enum.js`, `constants/user_types.js` |
| Web auth | `middleware/auth_middleware.js`, `routes/auth_routes.js` |
| Role gates | `middleware/role_middleware.js` |
| Mobile router | `routes/mobile/index.js` |
| Customer mobile | `routes/mobile/user/`, `controllers/mobile/user/`, `services/mobile/user/` |
| Partner mobile | `routes/mobile/partner/`, `controllers/mobile/partner/`, `services/mobile/partner/` |
| Notifications | `src/modules/notifications/` |
| Push FCM | `service/firebase/push_service.js` |
| Chat HTTP client | `services/chat_service_client.js`, `services/chat_integration.js` |
| Payments | `src/modules/payments/`, `routes/razorpay_routes.js` |
| Env mapping (partial) | `config/env.js` |
| Postman | `postman/Help-PR-All-APIs.postman_collection.json`, `Help-PR-Mobile-APIs.postman_collection.json` |

---

## 12. Related docs (go deeper)

| Doc | Use for |
|-----|---------|
| `docs/PROJECT_FLOW_AND_ROLES.md` | Role matrix, quote/order rules (some mobile notes there may be stale — this KT is current) |
| `docs/MOBILE_PUSH_NOTIFICATIONS.md` | Full push event catalog and wiring map |
| `docs/PUSH_NOTIFICATION_CLIENT_SPEC.md` | Title/body templates per instance |
| `docs/CHAT_MODULE_FRONTEND.md` | Socket.IO protocol, inbox by role |
| `docs/CHAT_SERVICE_ARCHITECTURE.md` | Lambda vs VPS boundaries |
| `docs/LAMBDA_VPS_DEPLOY.md` | How Chat Service is deployed |
| `docs/ORDER_MODULE_FRONTEND.md` | Order fields and pricing |
| `docs/WHATSAPP_WEBHOOK_SETUP.md` | WhatsApp OTP webhook |

---

*Written against the `help-pr-backend-staging` tree (web `/api` + mobile `/api/mobile`, notifications module, Chat Service HTTP client). For request/response fields, use Postman rather than this overview.*
