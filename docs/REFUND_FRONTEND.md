# Order refunds — frontend implementation guide

**Date:** May 2026  
**Base path:** `/api/refund`  
**API reference:** [REFUND_API.md](./REFUND_API.md) (endpoints, create body, DB side effects)  
**Postman:** `postman/Help-PR-Refunds.postman_collection.json` or **38 — Refunds** in `postman/Help-PR-All-APIs.postman_collection.json`  
**Backend:** `services/refund_service.js`, `controllers/refund_controller.js`, `utils/refund_access.js`

---

## 1. Overview

The refunds module records customer refunds against orders that have **completed** customer payments. Each refund is stored in **`order_refund`** and is **append-only** (no update/delete API).

**On create, the server automatically:**

1. Inserts a customer **`order_payment`** row with `status: "refunded"` and `amount = refund_amount`.
2. Recomputes the parent order’s **`payment_status`** (`refund` | `partially_refund` | etc.) via `syncOrderPaymentStatus`.
3. If **`from_partner_wallet` > 0**, creates a **debit** on the partner wallet ledger (same wallet as [Partner payout](./PARTNER_PAYOUT_FRONTEND.md)).

**Auth:** All endpoints require `Authorization: Bearer <JWT>` (same as other admin APIs).

**Access control:** `utils/refund_access.js` — same franchise rules as orders, quotes, and partner payout.

**On create:** `order_status` is set to **`refunded`** automatically (partial or full customer refund). Non-cancelled **service lines** are updated to **`refunded`** as well. `payment_status` becomes `partially_refund` or `refund` via payment sync.

---

## 2. Role-based access

| Caller type | Code | `getAll` / `eligible-orders` | `getById` / `create` |
|-------------|------|------------------------------|----------------------|
| Super admin | 5 | All franchises; optional `?franchise_id=` | Any order/refund in scope |
| Staff | 6 | Same as super admin | Same |
| Franchise admin | 1 | Only orders in caller’s franchise | Order/refund must belong to caller’s franchise |
| Franchise employee | 3 | Same as franchise admin | Same |
| Partner | 2 | **403** | **403** |
| Customer | 4 | **403** | **403** |

**Franchise admin** without a resolved franchise (no `franchise_id` on user and no franchise where they are `admin_id`) gets an **empty list**, not all orders.

**Wrong franchise:** Franchise admin/employee sends `franchise_id` for another franchise → **403**:

```json
{
  "success": false,
  "message": "You are not allowed to view refunds for this franchise."
}
```

**Create / getById** for a record outside the caller’s franchise → **403**:

```json
{
  "success": false,
  "message": "You are not allowed to access this refund."
}
```

---

## 3. Recommended UI flow

```text
[Refund list screen]     GET /getAll
      │
      ├─► [Row click / View]     GET /getById/:id
      │
      └─► [Create refund]        GET /eligible-orders  →  POST /create
```

| Screen | API |
|--------|-----|
| Refunds table (history) | `GET /getAll` |
| Create — order picker / search | `GET /eligible-orders` |
| Create — submit refund | `POST /create` |
| Refund detail (read-only) | `GET /getById/:id` |

There is **no update** endpoint. To correct a mistake, product/process must define a separate workflow (not supported by this API).

---

## 4. IDs — important

| Field | Where | Meaning |
|-------|--------|---------|
| `_id` on **eligible-orders** row | Picker | Order **MongoDB ObjectId**. Send as `order_id` on **create**. |
| `order_id` on **eligible-orders** / **getAll** | Display | Order **business code** (`order.unique_id`, e.g. `ORD-1001`). **Display only** on create. |
| `order_mongo_id` on **getAll** / **getById** | List/detail | Same as order Mongo `_id` (for deep links to order module). |
| `user_id` / `partner_id` on responses | List/detail | Customer and partner Mongo ids (set on create from order; not in create body). |
| `_id` on **getAll** row | List | Refund document Mongo `_id`. Use for **getById** path. |

**Common bug:** Sending display `order_id` (`ORD-1001`) as `order_id` on create will fail unless it happens to be a 24-char hex ObjectId.

---

## 5. List table (refund history)

Bind columns from **`GET /getAll`** → `data.records[]`:

| UI column | API field | Notes |
|-----------|-----------|--------|
| Order ID | `order_id` | Business `unique_id` |
| User Name | `user_name` | Customer name snapshot |
| Total Amount | `total_amount` | Order total at refund time |
| User Paid | `user_paid` | Completed customer payments sum at refund time |
| Refund Amount | `refund_amount` | Amount refunded in this record |
| From Admin Commission | `from_admin_commission` | Admin portion of refund (commission + tax + remainder; not capped at `admin_commission` only) |
| From Partner Wallet | `from_partner_wallet` | Portion debited from partner wallet |
| Date | `date` | `YYYY-MM-DD` (from `refund_date`) |

Row actions: **View** → `GET /getById/:record._id`.

---

## 6. Endpoints

### 6.1 `GET /api/refund/getAll` — refund list

Paginated refund history with search, date filter, and sort.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `page` | No | Default `1` |
| `limit` | No | Default `10`, max `100` |
| `order_id` | No | Search `order.unique_id` (regex) or order Mongo ObjectId |
| `user_name` | No | Case-insensitive customer name |
| `franchise_id` | No | Mongo ObjectId — super admin / staff scope |
| `from_date`, `to_date` | No | Filter on **refund date** (`refund_date`), ISO date |
| `sort_by` | No | `refund_date` (default), `order_id`, `user_name`, `refund_amount` |
| `sort_order` | No | `desc` (default) \| `asc` |

**Success `200`**

```json
{
  "success": true,
  "message": "Records fetched successfully",
  "data": {
    "records": [
      {
        "_id": "674a1b2c3d4e5f6789012345",
        "order_id": "ORD-1001",
        "order_mongo_id": "664a1b2c3d4e5f6789012345",
        "user_id": "664b00000000000000000001",
        "partner_id": "664c00000000000000000002",
        "user_name": "Jane Customer",
        "total_amount": 5000,
        "user_paid": 5000,
        "refund_amount": 1000,
        "from_admin_commission": 200,
        "from_partner_wallet": 800,
        "date": "2026-05-15",
        "refund_date": "2026-05-15T10:00:00.000Z",
        "franchise_id": "664f00000000000000000001",
        "notes": "Partial refund",
        "created_at": "2026-05-15T10:05:00.000Z"
      }
    ],
    "totalPages": 1,
    "totalItems": 1,
    "currentPage": 1,
    "limit": 10
  }
}
```

| Response field | UI use |
|----------------|--------|
| `date` | Table date column (`YYYY-MM-DD`) |
| `order_id` | Display + search; link to order detail with `order_mongo_id` |
| `_id` | Refund detail route / getById |

---

### 6.2 `GET /api/refund/eligible-orders` — create refund picker

**Eligibility (all required):**

1. `orders.order_status` is **`completed`** or **`cancelled`** (legacy numeric statuses supported).
2. Customer **`order_payment`** net refundable &gt; 0 (`completed` − `refunded`, `payer_type: customer`).
3. Order not deleted; franchise scope applies.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `page`, `limit` | No | Default `1`, `10`; max `100` |
| `order_id` | No | Search `unique_id` or Mongo ObjectId |
| `user_name` | No | Customer name search |
| `franchise_id` | No | Franchise filter (super admin / staff) |
| `sort_by` | No | `order_id` (default), `user_name`, `total_amount`, `user_paid` |
| `sort_order` | No | `asc` (default) \| `desc` |

**Success `200`**

```json
{
  "success": true,
  "message": "Eligible orders fetched successfully",
  "data": {
    "records": [
      {
        "_id": "664a1b2c3d4e5f6789012345",
        "order_id": "ORD-1001",
        "user_name": "Jane Customer",
        "total_amount": 5000,
        "user_paid": 4500,
        "refundable_amount": 4500,
        "partner_payable_amount": 3200,
        "admin_payable_amount": 1300,
        "payment_status": "partially_paid",
        "order_status": "completed",
        "franchise_id": "664f00000000000000000001"
      }
    ],
    "totalPages": 1,
    "totalItems": 1,
    "currentPage": 1,
    "limit": 10
  }
}
```

| Response field | UI use |
|----------------|--------|
| `_id` | Store as selected order; send as `order_id` on create |
| `order_id` | Display in picker/table |
| `user_paid` / `refundable_amount` | **Max refund amount** (same value; net paid available to refund) |
| `partner_payable_amount` | Suggested **`from_partner_wallet`** — ledger credits for **this order only** (0 if partner was never credited on this order) |
| `admin_payable_amount` | Suggested **`from_admin_commission`** on full refund — remainder (incl. tax); `admin_payable + partner_payable = refundable_amount` |
| `total_amount` | Pre-fill `total_amount` on create form |
| `payment_status` | Badge: `paid`, `partially_paid`, etc. |
| `order_status` | Must be `completed` or `cancelled` to appear in this list |

---

### 6.3 `GET /api/refund/getById/:id` — refund detail

Read-only view of one refund.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | **Yes** | Refund MongoDB ObjectId (path param) |

**Success `200`**

```json
{
  "success": true,
  "message": "Record fetched successfully",
  "data": {
    "_id": "674a1b2c3d4e5f6789012345",
    "order_id": "ORD-1001",
    "order_mongo_id": "664a1b2c3d4e5f6789012345",
    "user_id": "664b00000000000000000001",
    "partner_id": "664c00000000000000000002",
    "user_name": "Jane Customer",
    "total_amount": 5000,
    "user_paid": 5000,
    "refund_amount": 1000,
    "from_admin_commission": 200,
    "from_partner_wallet": 800,
    "date": "2026-05-15",
    "refund_date": "2026-05-15T10:00:00.000Z",
    "franchise_id": "664f00000000000000000001",
    "notes": "Partial refund — service cancelled",
    "created_at": "2026-05-15T10:05:00.000Z"
  }
}
```

---

### 6.4 `POST /api/refund/create` — record refund

**Body (JSON) — send only what the client must choose**

| Field | Required | Description |
|-------|----------|-------------|
| `order_id` | **Yes** | Order **MongoDB ObjectId** (`_id` from eligible-orders) |
| `refund_amount` | **Yes** | Positive number; ≤ current refundable balance |
| `date` | **Yes** | When refund was performed (ISO 8601) |
| `from_admin_commission` | No | Default `0`; must be ≥ 0 |
| `from_partner_wallet` | No | Default `0`; must be ≥ 0 |
| `notes` | No | Stored on refund + payment note |
| `payment_method` | No | Label on refund payment row (default `cash`) |

**Server derives from `order_id` — do not send in payload**

| Field | Source |
|-------|--------|
| `user_id` | `order.user_id` (customer) |
| `partner_id` | `order.partner_id` |
| `user_name` | Customer user `name` |
| `total_amount` | `order.total_price` |
| `user_paid` | Sum of completed customer payments on the order |
| `franchise_id` | `order.franchise_id` |
| `order_unique_id` | `order.unique_id` |

If the order has no customer or the customer name cannot be loaded → **400**.

**Split rule (server-enforced):**

```text
from_admin_commission + from_partner_wallet === refund_amount
```

(tolerance ±0.01 for floating point)

**Other validations**

| Rule | Error example |
|------|----------------|
| `refund_amount` ≤ refundable balance | `Refund amount exceeds refundable balance (4500).` |
| `from_partner_wallet` ≤ partner ledger net for this order | `Partner wallet portion exceeds partner credits for this order (X).` |
| `from_partner_wallet` ≤ partner wallet balance | `Partner wallet portion exceeds partner credits for this order (1200).` |
| Order has no partner and `from_partner_wallet` > 0 | `Order has no partner; partner wallet portion must be 0.` |

**Example request**

```json
{
  "order_id": "664a1b2c3d4e5f6789012345",
  "refund_amount": 1000,
  "from_admin_commission": 200,
  "from_partner_wallet": 800,
  "date": "2026-05-15T10:00:00.000Z",
  "notes": "Partial refund — service cancelled"
}
```

**Success `201`**

```json
{
  "success": true,
  "message": "Refund created successfully.",
  "data": {
    "_id": "674a1b2c3d4e5f6789012345",
    "order_id": "ORD-1001",
    "order_mongo_id": "664a1b2c3d4e5f6789012345",
    "user_id": "664b00000000000000000001",
    "partner_id": "664c00000000000000000002",
    "user_name": "Jane Customer",
    "total_amount": 5000,
    "user_paid": 5000,
    "refund_amount": 1000,
    "from_admin_commission": 200,
    "from_partner_wallet": 800,
    "date": "2026-05-15"
  }
}
```

After success:

- Refresh **getAll** and order detail if shown.
- Order `payment_status` may change to `partially_refund` or `refund`.
- Partner wallet balance decreases if `from_partner_wallet` > 0.

---

## 7. Create form — frontend implementation notes

### 7.1 Load eligible order

When user selects a row from **eligible-orders**, keep in state:

```ts
interface SelectedEligibleOrder {
  orderMongoId: string;      // row._id
  orderDisplayId: string;    // row.order_id
  userName: string;
  totalAmount: number;
  maxRefund: number;         // row.refundable_amount ?? row.user_paid
  maxAdminPayable: number;    // row.admin_payable_amount
  maxPartnerPayable: number;  // row.partner_payable_amount
}
```

### 7.2 Amount fields

| Input | Max | Min |
|-------|-----|-----|
| Refund amount | `maxRefund` | &gt; 0 |
| From admin commission | `refundAmount` (any non-negative split; no server ratio cap) | 0 |
| From partner wallet | `min(maxPartnerPayable, refundAmount)` — ledger net for this order | 0 |

**Split UX:** Finance staff choose both portions; server only requires **admin + partner = refund_amount** (± ₹0.01) and partner ≤ ledger credits for the order. `partner_payable_amount` / `admin_payable_amount` on eligible-orders are **suggested defaults** for a full refund, not enforced on partial refunds.

```ts
function validateSplit(refund: number, admin: number, partner: number): string | null {
  const sum = Math.round((admin + partner) * 100) / 100;
  const target = Math.round(refund * 100) / 100;
  if (Math.abs(sum - target) > 0.01) {
    return 'Admin commission + partner wallet must equal refund amount.';
  }
  return null;
}
```

### 7.3 Submit payload

Only send fields the user edits. Customer, partner, and order amounts come from the order:

```ts
await api.post('/api/refund/create', {
  order_id: selected.orderMongoId,
  refund_amount: form.refundAmount,
  from_admin_commission: form.fromAdminCommission,
  from_partner_wallet: form.fromPartnerWallet,
  date: form.refundDate.toISOString(),
  notes: form.notes,
});
```

Do **not** send `user_id`, `partner_id`, `user_name`, `total_amount`, or `user_paid` — the server resolves them from `order_id`.

### 7.4 Full vs partial refund

| Scenario | `refund_amount` | Expected `payment_status` after |
|----------|-----------------|----------------------------------|
| Full refund of net paid | `=== refundable_amount` | `refund` (if covers order total rules) |
| Partial refund | `< refundable_amount` | `partially_refund` (if some payment remains) |

See `docs/ORDER_MODULE_FRONTEND.md` for order-level `payment_status` labels.

---

## 8. Errors

All errors: `{ "success": false, "message": "..." }`.

| HTTP | Typical cause |
|------|----------------|
| `400` | Invalid ObjectId, missing `date`, bad amounts, split ≠ refund, exceeds limits |
| `401` | Missing / invalid JWT |
| `403` | Partner/customer caller, or wrong franchise |
| `404` | Order or refund not found |
| `409` | Invalid `franchise_id` format |
| `500` | Server error |

Examples:

```json
{
  "success": false,
  "message": "Admin portion and partner wallet portion must add up to the refund amount."
}
```

```json
{
  "success": false,
  "message": "Refund amount exceeds refundable balance (4500)."
}
```

---

## 9. Side effects & related modules

| System | What changes on create |
|--------|-------------------------|
| `order_refund` | New refund record |
| `order_payment` | New customer row, `status: "refunded"` |
| `order` | `payment_status`, `customer_*_amount` fields updated |
| `partner_wallet_ledger` | Debit if `from_partner_wallet` > 0 |

| Related doc / API | Use |
|-------------------|-----|
| [ORDER_MODULE_FRONTEND.md](./ORDER_MODULE_FRONTEND.md) | Order payments, `payment_status`, nested payments |
| [PARTNER_PAYOUT_FRONTEND.md](./PARTNER_PAYOUT_FRONTEND.md) | Partner wallet balance (same ledger debited on refund) |
| `GET /api/order-payments/by-order/:orderId` | Raw payment rows including refunds |
| `PUT /api/order/update/:id` | Change `order_status` separately if needed |

**Do not** create a separate `order_payment` with `status: "refunded"` via the standalone payment API **and** call refund create for the same money — that would double-count refunds.

---

## 10. Postman

**Folder:** `38 — Refunds` in `postman/Help-PR-All-APIs.postman_collection.json`

| # | Request |
|---|---------|
| 1 | Get all — refund list |
| 2 | Eligible orders — create refund picker |
| 3 | Get by id — refund detail |
| 4 | Create — record refund |

**Collection variables**

| Variable | Purpose |
|----------|---------|
| `baseUrl` | API host |
| `accessToken` | JWT from **00 — Auth → Login** |
| `franchiseId` | Optional franchise filter (super admin / staff) |
| `orderId` | Order Mongo `_id` from eligible-orders → **create** body |
| `refundMongoId` | Refund `_id` from getAll → **getById** |

**Suggested test sequence**

1. Login → set `accessToken`
2. **Eligible orders** → copy row `_id` → `orderId`
3. **Create** → adjust amounts (split must sum to `refund_amount`)
4. **Get all** → copy refund `_id` → `refundMongoId`
5. **Get by id** → verify detail

---

## 11. TypeScript types (reference)

```ts
export interface RefundListRecord {
  _id: string;
  order_id: string;
  order_mongo_id: string;
  user_id: string | null;
  partner_id: string | null;
  user_name: string;
  total_amount: number;
  user_paid: number;
  refund_amount: number;
  from_admin_commission: number;
  from_partner_wallet: number;
  date: string | null;
  refund_date?: string;
  franchise_id?: string | null;
  notes?: string;
  created_at?: string;
}

export interface EligibleOrderRecord {
  _id: string;
  order_id: string;
  user_name: string;
  total_amount: number;
  user_paid: number;
  refundable_amount: number;
  partner_payable_amount: number;
  admin_payable_amount: number;
  payment_status: string;
  franchise_id?: string | null;
}

export interface CreateRefundBody {
  order_id: string;
  refund_amount: number;
  date: string;
  from_admin_commission?: number;
  from_partner_wallet?: number;
  notes?: string;
  payment_method?: string;
}

export interface PaginatedResponse<T> {
  success: true;
  message?: string;
  data: {
    records: T[];
    totalPages: number;
    totalItems: number;
    currentPage: number;
    limit: number;
  };
}
```

---

## 12. Checklist for frontend PR

- [ ] List screen: columns §5, filters `order_id`, `user_name`, date range, pagination
- [ ] Super admin / staff: optional franchise filter (`franchise_id`)
- [ ] Create: picker uses **eligible-orders**; submit uses order `_id` not display id
- [ ] Create: split validation client-side; show server `message` on 400
- [ ] Create: cap amounts using eligible row (`refundable_amount`, `admin_payable_amount`, `partner_payable_amount`)
- [ ] Detail: read-only **getById**; link to order via `order_mongo_id`
- [ ] Hide module for partner (2) and customer (4) — expect 403
- [ ] No edit/delete UI for refunds
- [ ] After create: refresh list; optionally refresh order detail payment section
