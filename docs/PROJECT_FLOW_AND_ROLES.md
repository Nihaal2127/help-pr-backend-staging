# Help PR — End-to-end flows and role access

This document explains how the **Help PR** backend fits together: platform setup, franchise operations, partner onboarding, customer journey, quotes, orders, payments, and who can access what.

**Related docs**

- [ORDER_MODULE_FRONTEND.md](./ORDER_MODULE_FRONTEND.md) — order fields, pricing, payment APIs
- [REFUND_API.md](./REFUND_API.md) — refunds
- [../postman/README.md](../postman/README.md) — Postman setup and mobile test order

---

## Table of contents

1. [Platform overview](#1-platform-overview)
2. [Architecture](#2-architecture)
3. [User types](#3-user-types)
4. [Authentication](#4-authentication)
5. [Catalog hierarchy](#5-catalog-hierarchy)
6. [End-to-end business flow](#6-end-to-end-business-flow)
7. [Quote lifecycle](#7-quote-lifecycle)
8. [Order lifecycle and money](#8-order-lifecycle-and-money)
9. [Partner mobile flow (step by step)](#9-partner-mobile-flow-step-by-step)
10. [Customer flow (step by step)](#10-customer-flow-step-by-step)
11. [Role access matrix](#11-role-access-matrix)
12. [API surfaces by client](#12-api-surfaces-by-client)
13. [Important rules and constraints](#13-important-rules-and-constraints)

---

## 1. Platform overview

Help PR is a **franchise-based home-services marketplace**:

- **Platform layer** (Super Admin / Staff) — geography, global catalog, franchises, offers, subscriptions.
- **Franchise layer** (Admin / Employee) — partners, customers, local catalog, quotes, orders, verification, refunds (scoped to one franchise).
- **Partner layer** — service providers who register, get verified, configure services, and fulfil jobs.
- **Customer layer** — end users who book services, pay, and track orders.

```text
┌─────────────────────────────────────────────────────────────┐
│  Super Admin / Staff — global platform                      │
│  States, cities, areas, global categories/services,         │
│  franchises, offers, subscription plans                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Franchise Admin / Employee — one franchise territory        │
│  Partners, employees, customers, franchise catalog,          │
│  quotes, orders, partner verification, refunds             │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
┌─────────────────┐               ┌─────────────────┐
│  Partner (2)    │               │  Customer (4)   │
│  Mobile + web   │               │  OTP login      │
│  My services    │               │  Addresses      │
│  Jobs / payout  │               │  Quotes/orders  │
└─────────────────┘               └─────────────────┘
```

---

## 2. Architecture

### Request path

```text
HTTP Request
    → routes/           (path + middleware chain)
    → middleware/       (auth, validation, role checks)
    → controllers/      (request/response)
    → services/         (business logic)
    → models/           (MongoDB via Mongoose)
```

### Runtime

- **Local / VM:** `server.js` starts HTTP on `PORT` (default `5001`) and **Socket.IO** for chat.
- **AWS Lambda:** `exports.handler` uses `aws-serverless-express`; DB connects per invocation.

### Key modules

| Area | Location |
|------|----------|
| Auth | `middleware/auth_middleware.js`, `controllers/auth_controller.js` |
| User validation | `middleware/user_middleware.js` |
| User create permissions | `middleware/user_create_authorization_middleware.js` |
| Role gates | `middleware/role_middleware.js` |
| Franchise scope | `utils/franchise_scope_access.js`, `utils/franchise_user_scope.js` |
| Order access | `utils/order_access.js` |
| Quote access | `utils/quote_access.js` |
| Partner mobile | `routes/mobile/`, `services/mobile/partner/` |
| Chat | `help-pr-chat-service` on VPS (Lambda uses HTTP client only) |

---

## 3. User types

Defined on `user.type` in `models/user.js`:

| `type` | Name | Typical client |
|--------|------|----------------|
| **1** | Franchise Admin | Franchise web dashboard |
| **2** | Partner | Partner mobile app + partner web APIs |
| **3** | Employee | Franchise staff dashboard |
| **4** | Customer | Customer app (phone OTP) |
| **5** | Super Admin | Global admin |
| **6** | Staff | Platform operations (often with `accessible_screens`) |

Common user fields:

- `franchise_id` — links admin, employee, partner to a franchise
- `is_active` — must be true for web email login
- `verification_status` — partners: `1` Pending, `2` Verified, `3` Rejected
- `accessible_screens` — optional UI page permissions (staff)
- JWT in `Authorization: Bearer <token>` after login

Constants: `constants/user_types.js`, labels: `enum/user_type_enum.js`.

---

## 4. Authentication

### Web back-office and partners (email)

| Endpoint | Who |
|----------|-----|
| `POST /api/auth/login` | Admin, employee, partner, super admin, staff |
| `POST /api/auth/logout` | Any authenticated user |
| `POST /api/auth/forgotPassword` | Email-based reset |

Requirements: valid email/password, `is_active: true`, `deleted_at: null`.

### Customer (phone OTP)

| Step | Endpoint |
|------|----------|
| 1 | `POST /api/otp/send_otp` — `{ phone_number }` |
| 2 | `POST /api/otp/verify_otp` — `{ phone_number, otp, device_token }` |

User must **already exist** in the database (usually created by franchise staff). OTP verification issues a JWT.

Legacy: `POST /api/auth/userLogin` (phone + device_token).

### Customer mobile (phone OTP, Google, or Apple)

| Step | Endpoint |
|------|----------|
| Phone OTP | `POST /api/mobile/user/login` → `POST /api/mobile/user/verify-otp` |
| Google | `POST /api/mobile/user/google-login` — `{ id_token, device_token? }` |
| Apple | `POST /api/mobile/user/apple-login` — `{ id_token, device_token?, name? }` |

Phone flow auto-creates customers on first login. Google flow verifies the ID token server-side, creates or links a customer (`registration_type: 2`), and returns the same JWT shape as verify-otp. Apple flow mirrors Google (`registration_type: 3`, `apple_id` from token `sub`); send `name` from the client on first authorization only.

Env (customer app): `GOOGLE_CLIENT_ID_ANDROID`, `GOOGLE_CLIENT_ID_IOS`, optional `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID_WEB`.

Env (customer Apple): `APPLE_CLIENT_ID_IOS`, optional `APPLE_CLIENT_ID` / `APPLE_CLIENT_ID_WEB`.

Env (partner app): `GOOGLE_CLIENT_ID_ANDROID_PARTNER`, `GOOGLE_CLIENT_ID_IOS_PARTNER`, optional `GOOGLE_CLIENT_ID_PARTNER` / `GOOGLE_CLIENT_ID_WEB_PARTNER`.

Env (partner Apple): `APPLE_CLIENT_ID_IOS_PARTNER`, optional `APPLE_CLIENT_ID_PARTNER` / `APPLE_CLIENT_ID_WEB_PARTNER`.

### Partner mobile

| Endpoint | Auth | Notes |
|----------|------|-------|
| `POST /api/mobile/partner/register` | None | Creates partner (`type: 2`), returns token |
| `POST /api/mobile/partner/login` | None | Email/password |
| `POST /api/mobile/partner/google-login` | None | Google Sign-In — `{ id_token, device_token?, phone_number?, date_of_birth? }` |
| `POST /api/mobile/partner/apple-login` | None | Apple Sign-In — `{ id_token, device_token?, phone_number?, date_of_birth?, name? }` |
| `PUT /api/mobile/partner/update` | Bearer | Profile, docs, catalog (rules apply) |

### Public partner registration (web)

`POST /api/user/register-partner` — no JWT; multipart profile image and verification documents.

### Who can create users (`POST /api/user/create`)

| Creator | Allowed target types |
|---------|----------------------|
| Super Admin (5), Staff (6) | All types (1–6) |
| Franchise Admin (1), Employee (3) | Partner (2), Employee (3), Customer (4) — **own franchise only** |
| Partner (2), Customer (4) | **Not allowed** |

---

## 5. Catalog hierarchy

Services are offered at three levels:

```text
Global catalog                    Franchise catalog              Partner catalog
/api/category                     /api/franchise-category        /api/partner_category
/api/service                      /api/franchise-service         /api/partner_service
                                  (mapped to franchise areas)    /api/mobile/partner/my-services
```

| Level | Managed by | Purpose |
|-------|------------|---------|
| **Global** | Super Admin / Staff (+ approval workflow for franchise requests) | Master service definitions, commission/tax defaults |
| **Franchise** | Franchise Admin / Employee (scoped) | What the franchise offers in its territories |
| **Partner** | Partner (after verification) | What this partner actually sells and at what price |

Global **service** create/update by franchise staff often enters a **pending approval** workflow; Super Admin / Staff approve or reject (`utils/service_workflow.js`).

---

## 6. End-to-end business flow

### Phase A — Platform bootstrap (Super Admin / Staff)

1. Create **geography**: states → cities → areas.
2. Create **global categories and services** (`/api/category`, `/api/service`).
3. Create **franchises** — name, areas, admin user, linked services/categories.
4. Configure **subscription plans**, **offers**, **tax**, content, expense modules.

### Phase B — Franchise goes live (Admin / Employee)

1. Create **employees** (`type: 3`) for the franchise.
2. Onboard **partners** (create or approve self-registrations); set `franchise_id`.
3. Create **customers** (`type: 4`) or prepare records for OTP login.
4. Map **franchise catalog** from global services.
5. Operate **quotes** and **orders** within franchise scope.
6. **Verify** partners (`verification_status`).

### Phase C — Partner onboarding

See [Partner mobile flow](#9-partner-mobile-flow-step-by-step).

### Phase D — Sales: quote → order

See [Quote lifecycle](#7-quote-lifecycle) and [Order lifecycle](#8-order-lifecycle-and-money).

### Phase E — Money and closure

1. Customer **payments** (cash, UPI, Razorpay, etc.) → `order_payment` rows.
2. Optional **additional charges** → server recalculates `total_price`.
3. Mark order **completed** only when customer has **fully paid**.
4. **Partner payout** / wallet remittance.
5. **Refunds** (back-office only) if needed.

---

## 7. Quote lifecycle

**Model:** `models/quote.js`  
**APIs:** `/api/quote/*`  
**Statuses:** `new` → `pending` → `accepted` → `success` | `failed`

| Status | Meaning |
|--------|---------|
| `new` | Created; no partner assigned yet |
| `pending` | Partner assigned |
| `accepted` | Terms agreed; ready for conversion |
| `success` | **Order created** automatically (`order_id` set on quote) |
| `failed` | Rejected or cancelled |

### Typical flow

```text
1. Back-office creates quote (POST /api/quote/create)
      → customer (type 4), service, schedule, optional partner/employee/franchise
2. Assign partner → status becomes pending (auto or via update)
3. Update quote → accepted
4. Update quote → success
      → createOrderFromQuote() runs
      → Order + OrderService created, quote linked
```

**Who manages quotes:** Super Admin, Staff, Franchise Admin, Employee (list/detail scoped by franchise via `resolveQuoteListScope`).

**Customer view:** `GET /api/quote/getCustomerQuotes?user_id=<customerId>` (JWT required).

**Conversion rule:** Only **accepted** quotes can move to **success**; pricing must be valid (`services/quote_pricing_service.js`, `services/order_creation_service.js`).

---

## 8. Order lifecycle and money

**Model:** `models/order.js`, `models/order_services.js`  
**APIs:** `/api/order`, `/api/order-payments`, `/api/order-additional-charges`, `/api/razorpay`

### Order statuses

| `order_status` | Meaning |
|----------------|---------|
| `in-progress` | Default on create |
| `completed` | Job finished (requires full customer payment) |
| `cancelled` | Cancelled |
| `refunded` | Refunded |

### How orders are created

| Method | Who |
|--------|-----|
| Quote → **success** | Automatic (`createOrderFromQuote`) |
| `POST /api/order/create` | Back-office only (`assertCallerCanManageOrders`: types 1, 3, 5, 6) |

Customers and partners **do not** create orders via the admin create API.

### Pricing (server-side)

On create, the server snapshots service **commission**, **tax**, and **minimum deposit** percentages and computes:

```text
commission_amount = total_service_charge × commission%
sub_total         = total_service_charge + commission_amount
tax_amount        = (sub_total − discount) × tax%
total_price       = sub_total − discount + tax + additional_charges
```

Client-sent totals are compared; **server values win** (see `docs/ORDER_MODULE_FRONTEND.md`).

### Payments

- **Customer rollup:** `user_payment_status` — `unpaid` | `partially_paid` | `paid` | `refund` | `partially_refund`
- **Partner rollup:** `partner_payment_status` — remittance vs entitlement
- **Razorpay:** webhook/callback under `/api/razorpay`

### Customer order list

`GET /api/order/getCustomerOrder?user_id=<customerId>` — paginated orders for one customer.

### Back-office order list

`GET /api/order/getAll` — franchise-scoped for Admin/Employee; global (optional `franchise_id` filter) for Super Admin/Staff.

---

## 9. Partner mobile flow (step by step)

Base path: `/api/mobile/partner`  
Postman: `postman/Help-PR-Mobile-APIs.postman_collection.json`

### Suggested test order

```text
1. Location (no auth)
   GET /states → /cities → /areas → /pincodes

2. Register OR Login
   POST /register  — name, email, phone, password, date_of_birth (18+)
   POST /login     — email, password

3. Subscription (optional, auth)
   GET /subscription-plans

4. Update profile (auth, multipart allowed while pending)
   PUT /update — profile, address, verification documents

5. Admin approves partner (web)
   verification_status = 2 (Verified)

6. Catalog (auth, approved only for full catalog/bank)
   GET /categories — franchise catalog for picking services

7. Update again (auth, approved)
   PUT /update — partner_services, bank_account

8. My services (auth, approved for writes)
   GET    /my-services
   PUT    /my-services
   PATCH  /my-services/:id/status
   PATCH  /my-services/status  (bulk)
```

### Verification gates

| `verification_status` | Value | Mobile writes (catalog, bank, my-services) |
|-----------------------|-------|---------------------------------------------|
| Pending | 1 | Profile/docs/location OK; catalog/bank blocked |
| Verified | 2 | Full access |
| Rejected | 3 | Can login; catalog/bank/my-services writes return **403** |

Rejected partners still receive a clear message: account must be verified before catalog/bank updates.

### Partner web APIs (same role, `type: 2`)

- `GET /api/partner_service/myServices`
- `GET /api/partner_service/availableServices`
- `POST /api/partner_service/addMyServices`
- `PUT /api/partner_service/updateMyService/:id`

Middleware: `requirePartner` in `middleware/role_middleware.js`.

---

## 10. Customer flow (step by step)

Customers are **`user.type === 4`**.

### Typical journey

```text
1. Franchise staff creates customer
      POST /api/user/create  { type: 4, phone, name, date_of_birth, gender, ... }

2. Customer logs in
      POST /api/otp/send_otp
      POST /api/otp/verify_otp  → JWT

3. Customer manages addresses
      POST /api/address/create
      GET  /api/address/getAll

4. Staff creates quote for customer
      POST /api/quote/create  { user_id, service_id, schedule, partner_id, ... }

5. Quote progresses: new → pending → accepted → success
      → Order created automatically

6. Customer pays (via app integration / Razorpay / recorded payments)
      order_payment rows → user_payment_status updates

7. Partner completes job; back-office marks order completed (when paid)

8. Support ticket if needed
      POST /api/ticket/create
```

### What customers can do

| Action | API area |
|--------|----------|
| OTP login | `/api/otp` |
| Addresses | `/api/address` |
| Own quotes | `GET /api/quote/getCustomerQuotes?user_id=` |
| Own orders | `GET /api/order/getCustomerOrder?user_id=` |
| Home/count stats | `/api` count endpoints (filtered by `user_id` when `type === 4`) |
| Tickets | `/api/ticket` |

### What customers cannot do

- Create users, franchises, global/franchise catalog, or admin orders.
- Access `GET /api/order/getAll` or `GET /api/quote/getAll` (back-office).
- Partner mobile routes or refund/payout admin APIs.

> **Note:** `/api/mobile/user` routes exist but are currently **empty**. Customer apps use general `/api` routes with OTP JWT.

---

## 11. Role access matrix

**Legend:** **Full** = platform-wide | **Scoped** = own franchise | **Own** = own user/records | **—** = not allowed

| Capability | Super Admin (5) | Staff (6) | Franchise Admin (1) | Employee (3) | Partner (2) | Customer (4) |
|------------|:---------------:|:---------:|:-------------------:|:------------:|:-----------:|:--------------:|
| Web email login | ✓ | ✓ | ✓ | ✓ | ✓ | — (OTP) |
| Create users | Full | Full | Scoped | Scoped | — | — |
| User list (`/api/user/getAll`) | Full | Full | Scoped | Scoped | — | — |
| Franchise management | Full | Full | Own | Scoped read | — | — |
| Global category/service | Full | Full + approve | Request/workflow | Request/workflow | — | — |
| Franchise catalog | Full | Full | Scoped | Scoped | — | — |
| Partner my-services | Admin APIs | Admin APIs | Admin APIs | Admin APIs | **Own** | — |
| Quotes list (`getAll`) | Full | Full | Scoped | Scoped | — | — |
| Quote create/update | ✓ | ✓ | Scoped | Scoped | Assigned only | — |
| Orders list (`getAll`) | Full | Full | Scoped | Scoped | — | — |
| Order create | ✓ | ✓ | ✓ | ✓ | — | — |
| Order update/cancel | Scoped | Scoped | Scoped | Scoped | Participant* | — |
| Refunds | ✓ | ✓ | Scoped | Scoped | — | — |
| Offers create | ✓ | ✓ | — | — | — | — |
| Partner payout admin | ✓ | ✓ | Scoped | Scoped | — | — |
| Exports | ✓ | ✓ | ✓ | ✓ | — | — |
| Dashboard stats | Global | Global | Global endpoint | Global endpoint | — | — |
| Customer quotes/orders | — | — | — | — | — | **Own** (by `user_id`) |

\* Partners may have limited modify access when they are a **participant** on an order (`assertOrderModifyAccess`); primary operations are via back-office.

### Franchise scoping (types 1 and 3)

Implemented in `utils/franchise_scope_access.js`:

- **Super Admin / Staff:** all franchises; optional `franchise_id` query filter.
- **Franchise Admin / Employee:** only their `franchise_id` (or legacy orders linked to franchise members).
- **Partner / Customer:** **403** on back-office list endpoints (`getAll` for orders, quotes, refunds).

### Middleware quick reference

| Middleware | Allows |
|------------|--------|
| `authMiddleware` | Valid JWT |
| `requireBackoffice` | Types 1, 3, 5, 6 |
| `requirePartner` | Type 2 |
| `requireSuperAdmin` | Type 5 only |
| `requireSuperAdminOrStaff` | Types 5, 6 |
| `authorizeUserCreate` | Create-user rules per caller type |

---

## 12. API surfaces by client

| Client | Primary paths |
|--------|----------------|
| **Admin web** | `/api/auth`, `/api/user`, `/api/franchise*`, `/api/order`, `/api/quote`, `/api/dashboard`, `/api/export`, … |
| **Partner mobile** | `/api/mobile/partner/*` |
| **Partner web** | `/api/partner_service/*`, `/api/partner_category/*`, `/api/user/update` |
| **Customer app** | `/api/otp`, `/api/address`, `getCustomerOrder`, `getCustomerQuotes`, counts |
| **Realtime chat** | `/api/chat` + Socket.IO |

### Postman

1. Import `postman/Help-PR-All-APIs.postman_collection.json` (full) or `Help-PR-Mobile-APIs.postman_collection.json` (mobile).
2. Set `baseUrl` (e.g. `http://localhost:5001`).
3. Run **Auth → Login** or **Mobile → Partner → Login** to store `accessToken`.

---

## 13. Important rules and constraints

1. **Orders are not self-service for customers** — created by back-office or from quote **success**.
2. **Quote/Order `getAll`** is for back-office roles only (franchise-scoped for Admin/Employee).
3. **Order completion** requires `user_payment_status === paid` (full amount).
4. **Partner verification** gates catalog, bank, and my-services **writes** on mobile.
5. **Franchise isolation** — Admin/Employee cannot read another franchise’s orders/quotes/refunds.
6. **JWT payload** includes `id` and `type`; most checks reload the user from the database.
7. **Soft delete** — `deleted_at: null` filters apply across list APIs.
8. **Age rule** — users must be 18+ (`date_of_birth` validated in `user_middleware.js`).

---

## Diagram — quote to cash

```text
                    ┌──────────────┐
                    │ Create quote │
                    │ (back-office)│
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │ new → pending → accepted │
              └────────────┬────────────┘
                           │ status: success
              ┌────────────▼────────────┐
              │      Create order        │
              │  + order_service line    │
              └────────────┬────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
  │  Payments   │  │  Additional │  │   Partner   │
  │  (customer) │  │   charges   │  │   payout    │
  └──────┬──────┘  └─────────────┘  └─────────────┘
         │
         ▼
  ┌─────────────┐       ┌─────────────┐
  │  completed  │       │   refund    │
  │  (if paid)  │       │ (back-office)│
  └─────────────┘       └─────────────┘
```

---

*Last updated to match `help-pr-backend-staging` codebase structure. For field-level API contracts, use Postman collections and module-specific docs in `docs/`.*
