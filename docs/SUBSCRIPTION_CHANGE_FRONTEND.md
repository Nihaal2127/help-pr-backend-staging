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
| **Upgrade** | `wallet_amount` + `cash_amount` = `amount_to_pay` (no Razorpay v1) | Wallet portion debited |
| **Downgrade** | None | Unused value **credited** to partner wallet |

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
4. POST /subscription/change       → confirm (wallet + cash split for upgrade)
5. GET  /subscription/changes      → history (optional)
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

**Downgrade:** `wallet_credit` > 0, `amount_to_pay` = 0.

---

### 3.3 Apply change

```
POST /api/mobile/partner/subscription/change
```

**Upgrade body**

```json
{
  "target_plan_id": "...",
  "wallet_amount": 30,
  "cash_amount": 20
}
```

`wallet_amount + cash_amount` must equal `amount_to_pay` from preview (± ₹0.01).

**Downgrade body**

```json
{ "target_plan_id": "..." }
```

Do not send payment fields on downgrade.

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
DOWNGRADE: wallet_credit = remaining_value
```

**Excess remaining on upgrade** (remaining > new plan price): surplus is **forfeited**; `amount_to_pay = 0`.

---

## 5. Error responses

| Status | When |
|--------|------|
| 400 | Same plan, invalid payment split, payment on downgrade |
| 403 | Blocked account, unverified (preview/apply), not a partner |
| 404 | No active subscription, plan not found |
| 409 | Another change still `pending` (retry shortly) |
| 500 | Server / transaction failure |

---

## 6. Payment methods (v1)

| `payment_method` | Meaning |
|------------------|---------|
| `not_required` | Downgrade or zero-pay upgrade |
| `wallet` | Full amount from wallet |
| `cash` | Full amount cash (honor system) |
| `wallet_and_cash` | Split |

**Razorpay:** reserved for a future release (same pattern as order payments).

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
