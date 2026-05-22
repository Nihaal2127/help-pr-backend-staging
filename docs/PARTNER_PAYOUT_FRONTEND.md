# Partner payout (wallet) — frontend guide

**Date:** May 2026  
**Base path:** `/api/partner_payout`  
**Postman:** `postman/Help-PR-All-APIs.postman_collection.json` → **37 — Partner payout**  
**Backend:** `services/partner_payout_service.js`, `controllers/partner_payout_controller.js`, `utils/partner_payout_access.js`

---

## 1. Overview

Partner payouts use a **wallet + ledger** model:

- **Credits** — when a **partner `order_payment`** is **`completed`** (`payer_type: partner` on `/api/order-payments` or nested `order_payments`). Each payment credits the wallet (one ledger row per payment). **No credit on order create.** Total credits per order are capped by **`customer_net_paid`** and by order entitlement (`order_service.partner_earning` + `order.additional_charges_subtotal` base only — not tax/commission on extras).
- **Debits** — (1) admin **withdrawals** via **Create payout**; (2) refund `from_partner_wallet`.
- **Balance** = sum(credits) − sum(debits). Shown as `total_wallet_amount` / `payable_balance`.

**Use `/api/partner_payout` for the partner wallet UI.** Wallet credits come from completed partner **`order_payment`** rows (`payer_type: partner`), not from a separate financial-order table.

**Auth:** All endpoints require `Authorization: Bearer <JWT>` (same as other admin APIs).

**Access control:** Implemented in `utils/partner_payout_access.js` (same franchise rules as orders/quotes).

---

## 2. Role-based access

| Caller type | Code | `getAll` / `partners` | `show` / `create` |
|-------------|------|------------------------|-------------------|
| Super admin | 5 | All partners; optional `?franchise_id=` | Any partner in scope |
| Staff | 6 | Same as super admin | Same |
| Franchise admin | 1 | Only partners with `user.franchise_id` = caller’s franchise | Partner must belong to caller’s franchise |
| Franchise employee | 3 | Same as franchise admin | Same |
| Partner | 2 | **403** | **403** |
| Customer | 4 | **403** | **403** |

**Franchise admin** without a resolved franchise (no `franchise_id` on user and no franchise where they are `admin_id`) gets an **empty list**, not all partners.

**Wrong franchise:** If franchise admin/employee sends `franchise_id` (query or create body) for another franchise → **403**:

```json
{
  "success": false,
  "message": "You are not allowed to view partner payouts for this franchise."
}
```

**Create:** Server sets `franchise_id` on the body to the caller’s franchise for franchise admin/employee (they do not need to send it). Access to the target `partner_id` is checked before payout.

**Show / create** for a partner outside the caller’s franchise → **403** (`You are not allowed to access this partner.`).

---

## 3. Recommended UI flow

```text
[List screen]  GET /getAll
      │
      ├─► [Pay modal]  GET /partners  →  POST /create
      │
      └─► [Partner detail / ledger]  GET /show?id=<partner _id>
```

| Screen | API |
|--------|-----|
| Partner wallet table | `GET /getAll` |
| “Pay partner” dropdown + max amount | `GET /partners` |
| Submit withdrawal | `POST /create` |
| Partner ledger (credits & debits) | `GET /show` |

---

## 4. IDs — important

| Field | Meaning |
|-------|---------|
| `_id` on list/dropdown rows | Partner **MongoDB ObjectId** (`user` document). Use for `show?id=` and `create` body `partner_id`. |
| `partner_id` on list/dropdown rows | Partner **business code** (`user.user_id` string). Display only — **do not** send as `partner_id` on create unless it happens to be a valid 24-char ObjectId. |

---

## 5. Endpoints

### 5.1 `GET /api/partner_payout/getAll` — wallet list

Paginated table of all partners (user `type === 2`) with wallet summary.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `page` | No | Default `1` |
| `limit` | No | Default `10`, max `100` |
| `search` | No | Matches partner `name` or `user_id` (business id) |
| `wallet_status` | No | `pending` \| `paid` — filters after balance is computed |
| `franchise_id` | No | Mongo ObjectId — only partners in that franchise |
| `from_date`, `to_date` | No | Filter by **last withdrawal date** (`last_withdraw_date`), ISO date |
| `sort_by` | No | `partner_name` (default), `total_wallet_amount`, `last_withdraw_date`, `wallet_status` |
| `sort_order` | No | `asc` (default) \| `desc` |

**Success `200`**

```json
{
  "success": true,
  "message": "Records fetched successfully",
  "data": {
    "records": [
      {
        "_id": "664a1b2c3d4e5f6789012345",
        "partner_id": "PRT-1024",
        "partner_name": "John Partner",
        "total_wallet_amount": 4500.5,
        "last_withdraw_amount": 2000,
        "last_withdraw_date": "2026-05-10",
        "wallet_status": "pending"
      }
    ],
    "totalPages": 3,
    "totalItems": 25,
    "currentPage": 1,
    "limit": 10
  }
}
```

| Response field | UI use |
|----------------|--------|
| `total_wallet_amount` | Current balance (₹); can be `0` |
| `wallet_status` | `pending` if balance &gt; 0, else `paid` |
| `last_withdraw_amount` / `last_withdraw_date` | Last payout; date is `YYYY-MM-DD` or null |

---

### 5.2 `GET /api/partner_payout/partners` — pay modal dropdown

Lightweight list for “Pay partner” — includes **payable balance**.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `franchise_id` | No | Scope partners to franchise |
| `search` | No | Same as getAll |
| `limit` | No | Default `250`, max `250` |

**Success `200`**

```json
{
  "success": true,
  "data": {
    "records": [
      {
        "_id": "664a1b2c3d4e5f6789012345",
        "partner_id": "PRT-1024",
        "partner_name": "John Partner",
        "total_wallet_amount": 4500.5,
        "payable_balance": 4500.5
      }
    ],
    "totalItems": 12
  }
}
```

Use **`payable_balance`** as the max for `pay_now_amount` on create (server re-validates).

---

### 5.3 `GET /api/partner_payout/show` — wallet ledger

Transaction history for one partner.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | **Yes** | Partner MongoDB ObjectId (`_id` from list) |
| `page`, `limit` | No | Default `1`, `10`, max `100` |
| `transaction_type` | No | `credit` \| `debit` |
| `from_date`, `to_date` | No | Filter on ledger `date` |
| `search` | No | Matches `description`, `order_unique_id`, `payment_method` |

**Success `200`**

```json
{
  "success": true,
  "data": {
    "partner": {
      "partner_id": "PRT-1024",
      "partner_name": "John Partner",
      "total_wallet_amount": 4500.5
    },
    "records": [
      {
        "_id": "...",
        "date": "2026-05-12",
        "transaction_type": "credit",
        "order_id": "...",
        "order_unique_id": "ORD-9001",
        "order_payment_id": null,
        "description": "Order ORD-9001 — partner earning",
        "payment_method": null,
        "amount": 1500
      },
      {
        "_id": "...",
        "date": "2026-05-15",
        "transaction_type": "debit",
        "order_id": null,
        "order_unique_id": null,
        "description": "Partner withdrawal — ref UTR998877",
        "payment_method": "upi",
        "amount": 2000
      }
    ],
    "totalPages": 1,
    "totalItems": 2,
    "currentPage": 1,
    "limit": 10
  }
}
```

| `transaction_type` | Meaning |
|--------------------|---------|
| `credit` | Earning from a financial order (owed to partner) |
| `debit` | Payout / withdrawal |

---

### 5.4 `POST /api/partner_payout/create` — record withdrawal

**Body (JSON)**

| Field | Required | Description |
|-------|----------|-------------|
| `partner_id` | **Yes** | Partner **MongoDB ObjectId** (`_id` from list/dropdown) |
| `pay_now_amount` | **Yes** | Positive number; must be ≤ `payable_balance` |
| `payment_method` | **Yes** | `upi` \| `bank_transfer` \| `cash` \| `cheque` \| `other` |
| `description` | **Yes** | Non-empty (e.g. UTR / reference note) |
| `franchise_id` | No | Validated if partner is tied to a franchise |

**Example**

```json
{
  "partner_id": "664a1b2c3d4e5f6789012345",
  "pay_now_amount": 3200,
  "payment_method": "upi",
  "description": "Partner withdrawal — ref UTR998877",
  "franchise_id": "664f00000000000000000001"
}
```

**Success `201`**

```json
{
  "success": true,
  "message": "Partner payout created successfully.",
  "data": {
    "_id": "...",
    "partner_id": "PRT-1024",
    "pay_now_amount": 3200,
    "payment_method": "upi",
    "description": "Partner withdrawal — ref UTR998877",
    "franchise_id": "...",
    "created_at": "2026-05-20T10:30:00.000Z"
  }
}
```

After success, refresh **getAll** / **show** — balance is reduced via a new ledger **debit**.

---

## 6. Errors

All errors use `{ "success": false, "message": "..." }`.

| HTTP | Typical cause |
|------|----------------|
| `400` | Invalid ObjectId, amount &gt; payable balance, invalid `wallet_status` / `payment_method` / `transaction_type`, missing `description` |
| `403` | Partner/customer caller, or franchise admin/employee accessing another franchise or partner |
| `404` | Partner or franchise not found |
| `409` | Invalid `franchise_id` format (optional filter for super admin/staff) |
| `500` | Server error |

Example:

```json
{
  "success": false,
  "message": "pay_now_amount exceeds payable balance (1500)."
}
```

---

## 7. Data source (credits)

Credits are **synced from completed partner `order_payment` rows** via `partner_wallet_order_service.syncAllPartnerOrderPaymentsForOrder` (also after repricing, refunds, and order cancel). Run `node scripts/migrate-partner-wallet-payment-credits.js` once when upgrading from the old order-level credit model.

**Note:** Create payout does **not** change order payment rollups. Balance is always **ledger-based** (credits − debits). Financial overview UI uses **`GET /api/order/financial-payments/getAll`** (see `docs/FINANCIAL_ORDER_PAYMENTS_API.md`).

---

## 8. Related APIs

| API | Use |
|-----|-----|
| `POST /api/getCount` with `"type": "financial-order-payments"` (4) | Financial dashboard cards from `order` rollups — see `docs/FINANCIAL_ORDER_PAYMENTS_API.md` |
| `GET /api/order/financial-payments/getAll` | Order-level partner/customer payment overview |
| `POST /api/export/partner` | Partner directory export; **Wallet Balance** column uses ledger (credits − debits) |

---

## 9. Postman variables

| Variable | Purpose |
|----------|---------|
| `baseUrl` | API host |
| `accessToken` | JWT from **00 — Auth → Login** |
| `franchiseId` | Optional franchise filter |
| `partnerMongoId` | Partner `user._id` for **show** and **create** |

After **getAll**, copy a row’s `_id` into `partnerMongoId` for ledger and create tests.
