# Partner subscription upgrade / downgrade — mobile frontend guide

**Date:** June 2026  
**Base path:** `/api/mobile/partner/subscription`  
**Postman:** `postman/Help-PR-Mobile-APIs.postman_collection.json` → **Partner → Subscription**  
**Backend:** `services/mobile/partner/subscription_change_service.js`, `utils/subscription_proration.js`

---

## 1. Overview

Partners can **upgrade** or **downgrade** their subscription tier from the mobile app.

| Action | Payment | Wallet |
|--------|---------|--------|
| **Upgrade** | `wallet_amount` + `cash_amount` or `online_amount` = `amount_to_pay` when due | Wallet portion debited immediately; online via Razorpay link |
| **Downgrade** | Same as upgrade when `amount_to_pay` > 0 | Credit **surplus** (`wallet_credit`) when unused value exceeds new plan price |

**Requirements**

- Partner JWT (`user.type === 2`)
- Account **not blocked**
- **Preview** and **apply** require `verification_status === 2` (approved)
- Active subscription (`status: active`, not past `expires_at`)

**Proration** uses plan `duration` / `duration_type` (not stored `expires_at`). After any change, a **new full plan period** starts immediately.

---

## 2. Recommended UI flow

```text
1. GET  /subscription              → show current plan + wallet balance
2. GET  /subscription-plans        → plan picker (catalog)
3. POST /subscription/change/preview → quote screen
4. POST /subscription/change       → confirm (wallet + cash or wallet + online)
5. GET  /subscription/change/:id/payment-status → poll after online payment (optional)
6. GET  /subscription/changes      → history (optional)
```

---

## 3. Endpoints

### 3.1 Get current subscription

```
GET /api/mobile/partner/subscription
Authorization: Bearer <token>
```

**200 `data`**

| Field | Type | Notes |
|-------|------|-------|
| `subscription` | object \| null | `_id`, `started_at`, `expires_at`, `status`, `plan` |
| `wallet_balance` | number | Partner wallet (credits − debits) |
| `days_used` | number | UTC whole days since `started_at` |
| `days_total` | number | Plan validity in days |

---

### 3.2 Preview change

```
POST /api/mobile/partner/subscription/change/preview
```

**Body**

```json
{ "target_plan_id": "<24-char ObjectId>" }
```

**200 `data` (upgrade example)**

```json
{
  "change_type": "upgrade",
  "current_plan": { "plan_name": "silver", "price": 60 },
  "target_plan": { "plan_name": "gold", "price": 90 },
  "days_used": 10,
  "days_total": 30,
  "daily_rate": 2,
  "consumed_value": 20,
  "remaining_value": 40,
  "amount_to_pay": 50,
  "wallet_credit": 0,
  "wallet_balance": 120,
  "new_expires_at": "2026-07-09T..."
}
```

**Downgrade (credit):** `wallet_credit` > 0, `amount_to_pay` = 0 — unused value exceeds new plan price.

**Downgrade (payment due):** `amount_to_pay` > 0, `wallet_credit` = 0 — new plan price exceeds unused value (e.g. late in billing period).

---

### 3.3 Apply change

```
POST /api/mobile/partner/subscription/change
```

`wallet_amount + cash_amount` or `wallet_amount + online_amount` must equal `amount_to_pay` from preview (± ₹0.01). Use **either** `cash_amount` or `online_amount`, not both.

**Upgrade body (cash)**

```json
{
  "target_plan_id": "...",
  "wallet_amount": 30,
  "cash_amount": 20
}
```

**Upgrade body (Razorpay — UPI / card / netbanking)**

```json
{
  "target_plan_id": "...",
  "wallet_amount": 30,
  "online_amount": 20
}
```

**Downgrade body (no payment due)**

```json
{ "target_plan_id": "..." }
```

**Downgrade body (payment due)** — same shape as upgrade; amounts must match preview `amount_to_pay`.

**200 `data`**

```json
{
  "subscription": { "plan": { "plan_name": "gold" }, "expires_at": "..." },
  "change": {
    "change_type": "upgrade",
    "amount_to_pay": 50,
    "wallet_amount": 30,
    "cash_amount": 20,
    "payment_method": "wallet_and_cash"
  },
  "wallet_balance": 90
}
```

---

### 3.4 Change history

```
GET /api/mobile/partner/subscription/changes?page=1&limit=10
```

**200 `data`:** `totalItems`, `totalPages`, `currentPage`, `limit`, `records[]` with `from_plan`, `to_plan`, amounts, `applied_at`.

---

## 4. Proration formulas

```text
daily_rate      = current_plan.price / plan_validity_days
consumed_value  = days_used × daily_rate
remaining_value = current_plan.price − consumed_value

UPGRADE:   amount_to_pay = max(0, new_plan.price − remaining_value)
           wallet_credit = 0

DOWNGRADE: amount_to_pay = max(0, new_plan.price − remaining_value)
           wallet_credit = max(0, remaining_value − new_plan.price)
```

**Excess remaining on upgrade** (remaining > new plan price): surplus is **forfeited**; `amount_to_pay = 0`.

**Excess remaining on downgrade** (remaining > new plan price): surplus is **credited** to wallet; `amount_to_pay = 0`.

---

## 5. Error responses

| Status | When |
|--------|------|
| 400 | Same plan, invalid payment split, payment sent when `amount_to_pay` is 0 |
| 403 | Blocked account, unverified (preview/apply), not a partner |
| 404 | No active subscription, plan not found |
| 409 | Another change still `pending` (retry after ~1 minute; stale `pending` rows auto-expire) |
| 500 | Server / transaction failure |

---

## 6. Payment methods

| `payment_method` | Meaning |
|------------------|---------|
| `not_required` | Downgrade or zero-pay upgrade |
| `wallet` | Full amount from wallet |
| `cash` | Full amount cash (honor system) |
| `wallet_and_cash` | Split wallet + cash |
| `online` | Full amount via Razorpay (UPI / card / netbanking) |
| `wallet_and_online` | Split wallet + Razorpay |

### 6.1 Online payment (Razorpay)

When paying online, send `online_amount` instead of `cash_amount` for the non-wallet portion. Cash and online are **mutually exclusive**.

**Upgrade body (online)**

```json
{
  "target_plan_id": "...",
  "wallet_amount": 30,
  "online_amount": 20
}
```

**Full online**

```json
{
  "target_plan_id": "...",
  "wallet_amount": 0,
  "online_amount": 50
}
```

**202 response (payment pending)**

```json
{
  "success": true,
  "status": 202,
  "message": "Complete payment to apply your subscription change.",
  "data": {
    "change": {
      "_id": "...",
      "payment_url": "https://rzp.io/i/...",
      "resumed": false
    }
  }
}
```

**Tap Pay again after backing out of Razorpay:** call the same **POST /subscription/change** again with the same body. The server returns **202** with the **same** `payment_url` and `"resumed": true` (no 409). Wallet portion is not debited twice.

**Poll payment status** also returns `payment_url` while `status` is `pending`.

Open `payment_url` in a browser or WebView. Razorpay supports **UPI, cards, and net banking** on the same link.

After payment, Razorpay calls `POST /api/razorpay/razorpayWebhook` (`payment_link.paid`). The backend completes the subscription change automatically.

**Poll payment status**

```
GET /api/mobile/partner/subscription/change/:changeId/payment-status
```

**200 `data`:** `status`, `payment_status`, `target_plan`, `applied_at` (set when completed).

If payment was made but status stays `pending` (webhook issue on Lambda), **call this endpoint again** — the server checks Razorpay directly and completes the change when the link is `paid`. Look for `data.sync.synced: true`.

**Env vars (backend `.env`):**

```env
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_BASE_URL=https://your-ngrok-url.ngrok.io
```

`RAZORPAY_BASE_URL` is the **public** URL Razorpay can reach (often ngrok in dev). This is separate from Postman `{{baseUrl}}`, which is your backend API base for app requests.

Configure the webhook in [Razorpay Dashboard](https://dashboard.razorpay.com) → Webhooks → `payment_link.paid` → URL `{RAZORPAY_BASE_URL}/api/razorpay/razorpayWebhook`.

Pending online changes expire after **24 hours**; any wallet portion is refunded automatically.

### 6.2 Gateway payment records (`gateway_payment` collection)

Each completed Razorpay online payment creates a row in **`gateway_payment`** (separate from `partner_subscription_change`):

| Field | Example |
|-------|---------|
| `purpose` | `subscription_change` |
| `reference_id` | subscription change `_id` |
| `payer_type` | `partner` |
| `amount` | online portion in INR |
| `gateway_payment_link_id` | `plink_xxx` |
| `gateway_payment_id` | `pay_xxx` (Razorpay payment id) |
| `instrument_type` | `card`, `upi`, `netbanking`, … |

`partner_subscription_change.transaction_reference` stores `pay_xxx` when available.

**GET payment-status** includes `data.gateway_payment` when completed.

Orders will use the same collection with `purpose: order` later.

**Webhook note:** The server verifies Razorpay signatures against the **raw** JSON body (`express.raw` on the webhook route). Do not put a reverse proxy in front that re-serializes the payload.

---

## 7. Related APIs

| API | Purpose |
|-----|---------|
| `GET /api/mobile/partner/subscription-plans` | Plan catalog |
| `GET /api/partner-subscription/me` | Legacy admin-route “my subscription” (still works) |
| Admin `POST /api/partner-subscription/create` | Manual assign (no proration) |

---

## 8. Wallet ledger

Upgrade wallet debits and downgrade credits appear in `partner_wallet_ledger` with `subscription_change_id` set. Partners see balance via `GET /subscription` (`wallet_balance`). Admin ledger UI uses `/api/partner_payout` (see `PARTNER_PAYOUT_FRONTEND.md`).
