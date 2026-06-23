# Order refunds — API reference

**Base path:** `/api/refund`  
**Postman:** `postman/Help-PR-Refunds.postman_collection.json` (standalone) or **38 — Refunds** in `postman/Help-PR-All-APIs.postman_collection.json`  
**Frontend guide:** [REFUND_FRONTEND.md](./REFUND_FRONTEND.md)  
**Backend:** `services/refund_service.js`, `controllers/refund_controller.js`, `routes/refund_routes.js`

---

## Setup (Postman)

1. Import `Help-PR-Refunds.postman_collection.json` or use folder **38 — Refunds** in the all-APIs collection.
2. Set collection variables: `baseUrl`, `franchiseId` (optional for super admin/staff).
3. Run **00 — Auth → Login** in the all-APIs collection (or set `accessToken` manually).
4. Recommended flow: **2. Eligible orders** → **4. Create** → **1. Get all** → **3. Get by id**.

| Variable | Set from |
|----------|----------|
| `orderId` | Eligible-orders row `_id` (order Mongo id for create) |
| `refundMongoId` | GetAll or create response `data._id` |

---

## Access control

| Caller type | Code | Access |
|-------------|------|--------|
| Super admin | 5 | All franchises; optional `franchise_id` query/body |
| Staff | 6 | Same as super admin |
| Franchise admin | 1 | Own franchise only |
| Franchise employee | 3 | Own franchise only |
| Partner | 2 | **403** |
| Customer | 4 | **403** |

All endpoints require `Authorization: Bearer <JWT>`.

---

## Endpoints summary

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/refund/getAll` | Paginated refund history |
| `GET` | `/api/refund/eligible-orders` | Orders with refundable customer balance |
| `GET` | `/api/refund/getById/:id` | Single refund record |
| `POST` | `/api/refund/create` | Record a refund (append-only) |

There is **no update or delete** endpoint.

---

## 1. `GET /api/refund/getAll`

Refund history table.

### Query parameters

| Param | Required | Description |
|-------|----------|-------------|
| `page` | No | Default `1` |
| `limit` | No | Default `10`, max `100` |
| `order_id` | No | Search `order_unique_id` or order Mongo ObjectId |
| `user_name` | No | Customer name (case-insensitive) |
| `from_date` | No | Filter `refund_date` ≥ date |
| `to_date` | No | Filter `refund_date` ≤ end of day |
| `franchise_id` | No | Scope (super admin / staff) |
| `sort_by` | No | `order_id` \| `user_name` \| `refund_date` \| `refund_amount` (default `refund_date`) |
| `sort_order` | No | `asc` \| `desc` (default `desc`) |

### Success `200`

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

| Field | Meaning |
|-------|---------|
| `order_id` | Business display id (`order.unique_id`) |
| `order_mongo_id` | Order Mongo `_id` |
| `total_amount` | `order.total_price` at refund time (context only) |
| `user_paid` | Sum of **completed** customer payments at refund time |
| `refund_amount` | Amount refunded in this record |

---

## 2. `GET /api/refund/eligible-orders`

Orders eligible for a refund. **All conditions must pass:**

1. **`orders.order_status`** is **`completed`** or **`cancelled`** (includes legacy numeric status values).
2. Order is not soft-deleted (`deleted_at` null).
3. Customer **`order_payment`**: sum of `completed` − sum of `refunded` &gt; 0 (`refundable_amount`).
4. Franchise scope (role-based), optional `order_id` / `user_name` search.

### Query parameters

| Param | Required | Description |
|-------|----------|-------------|
| `page`, `limit` | No | Pagination (max `limit` 100) |
| `order_id` | No | Search display id or Mongo id |
| `user_name` | No | Customer name search |
| `franchise_id` | No | Franchise scope |
| `sort_by` | No | `order_id` \| `user_name` \| `total_amount` \| `user_paid` |
| `sort_order` | No | `asc` \| `desc` |

### Success `200`

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

| Field | Meaning |
|-------|---------|
| `_id` | **Send as `order_id` on create** (order Mongo ObjectId) |
| `order_id` | Display id only |
| `total_amount` | `order.total_price` (context only; not the refund cap) |
| `user_paid` / `refundable_amount` | **Max `refund_amount`** = net customer paid |
| `razorpay_refundable_amount` | Max refundable **via Razorpay API** on this order (completed online captures minus prior gateway refunds) |
| `partner_payable_amount` | Max partner clawback for this order — **only** `partner_wallet_ledger` credits − debits where `order_id` matches (not global wallet, not order entitlement) |
| `admin_payable_amount` | Admin share on full refund — `refundable_amount − partner_payable_amount` (commission, taxes, and remainder) |

```text
partner_payable_amount + admin_payable_amount = refundable_amount
```

---

## 3. `GET /api/refund/getById/:id`

`:id` = refund document Mongo `_id` from getAll or create response.

### Success `200`

Same shape as one `records[]` item from getAll (wrapped in `data`).

### Errors

| Status | When |
|--------|------|
| `400` | Invalid ObjectId |
| `403` | Franchise access denied |
| `404` | Refund not found |

---

## 4. `POST /api/refund/create`

Records a refund. **Append-only.**

### Request body

| Field | Required | Description |
|-------|----------|-------------|
| `order_id` | **Yes** | Order **Mongo ObjectId** (from eligible-orders `_id`) |
| `refund_amount` | **Yes** | Positive number; ≤ **customer net paid** (completed − prior refunds) |
| `date` | **Yes** | Refund date (ISO 8601). Alias: `refund_date` |
| `from_admin_commission` | No | Default `0`. Admin/platform portion of this refund (commission, tax, fees, etc.). **Chosen by the client**; must satisfy the split rule below — **not** capped at `order.admin_commission` alone |
| `from_partner_wallet` | No | Default `0`. Partner wallet debit portion |
| `notes` | No | Stored on refund + payment |
| `payment_method` | No | Default `"cash"` on payment row (ignored when `refund_via_razorpay: true` → stored as `online`) |
| `transaction_reference` | No | External reference on payment row (auto-filled with Razorpay `rfnd_xxx` when using Razorpay) |
| `refund_via_razorpay` | No | When `true`, calls Razorpay Refund API before recording ledger rows. **Admin only** (same as all refund routes). |
| `refund_channel` | No | Alias: send `"razorpay"` instead of `refund_via_razorpay: true` |
| `franchise_id` | No | Access scope only (not stored on refund) |

**Do not send:** `user_id`, `partner_id`, `user_name`, `total_amount`, `user_paid` — derived from order.

### Split rule

```text
from_admin_commission + from_partner_wallet = refund_amount   (± ₹0.01)
```

### Example request (manual / offline refund)

```json
{
  "order_id": "664a1b2c3d4e5f6789012345",
  "refund_amount": 1000,
  "from_admin_commission": 200,
  "from_partner_wallet": 800,
  "date": "2026-05-15T10:00:00.000Z",
  "notes": "Customer requested refund",
  "payment_method": "bank_transfer",
  "transaction_reference": "TXN-REF-001"
}
```

### Example request (Razorpay — money returned to customer card/UPI)

```json
{
  "order_id": "664a1b2c3d4e5f6789012345",
  "refund_amount": 1000,
  "from_admin_commission": 200,
  "from_partner_wallet": 800,
  "date": "2026-05-15T10:00:00.000Z",
  "notes": "Customer requested Razorpay refund",
  "refund_via_razorpay": true
}
```

**Razorpay rules:**

- `refund_amount` must be ≤ `razorpay_refundable_amount` from **eligible-orders** (and ≤ overall `refundable_amount`).
- Server calls `POST /v1/payments/:pay_id/refund` on Razorpay (FIFO across captures if multiple online payments).
- Response `data.refund_channel` = `razorpay`; `data.razorpay_refund_details` lists `rfnd_xxx` ids.
- Partner wallet clawback (`from_partner_wallet`) still applies in your ledger — Razorpay only returns money to the customer.

### Success `201`

```json
{
  "success": true,
  "message": "Refund created successfully.",
  "data": {
    "_id": "674a1b2c3d4e5f6789012345",
    "order_id": "ORD-1001",
    "order_mongo_id": "664a1b2c3d4e5f6789012345",
    "refund_amount": 1000,
    "from_admin_commission": 200,
    "from_partner_wallet": 800,
    "date": "2026-05-15"
  }
}
```

### Validation errors (examples)

| Message | Cause |
|---------|--------|
| `Refund amount exceeds refundable balance (X)` | Refund amount &gt; customer net paid |
| `Admin portion and partner wallet portion must add up to the refund amount.` | Split mismatch |
| `Partner wallet portion exceeds partner credits for this order (X)` | `from_partner_wallet` &gt; partner wallet ledger net (credits − debits) for **this order** |
| `Refund amount exceeds Razorpay refundable balance (X)` | `refund_via_razorpay` but amount &gt; online capture balance |
| `No Razorpay payments available to refund for this order.` | `refund_via_razorpay` but order has no completed Razorpay captures |
| `Order has no partner; partner wallet portion must be 0` | Partner debit without partner |

---

## What create updates (by request field)

```text
POST /api/refund/create
        │
        ├─► INSERT order_payment (customer, status=refunded, amount=refund_amount)
        ├─► INSERT order_refund (history + split snapshot)
        ├─► INSERT partner_wallet_ledger debit (if from_partner_wallet > 0)
        ├─► UPDATE order (payment rollups via syncOrderPaymentStatus)
        └─► UPDATE order_services.is_paid (from synced order)
```

### Per request field

| Request field | Database / side effect |
|---------------|-------------------------|
| `order_id` | Loads order; all writes scoped to this order |
| `refund_amount` | `order_payment.amount`, `order_refund.refund_amount`; drives payment status rollup |
| `date` | `order_payment.paid_at`, `order_refund.refund_date`, ledger `date` |
| `from_admin_commission` | `order_refund.from_admin_commission` only (does **not** change `order.admin_earning` today) |
| `from_partner_wallet` | `order_refund.from_partner_wallet`; optional ledger **debit** |
| `notes` | `order_refund.notes`, `order_payment.notes` |
| `payment_method` | `order_payment.payment_method` |
| `transaction_reference` | `order_payment.transaction_reference` |
| JWT user | `order_refund.created_by_id` |

### Server-derived on `order_refund` (not from body)

| Field | Source |
|-------|--------|
| `order_unique_id`, `franchise_id` | Order |
| `user_id`, `user_name` | Customer on order |
| `partner_id` | `order.partner_id` |
| `total_amount` | `order.total_price` |
| `user_paid` | Sum of completed customer payments |
| `order_payment_id` | New refund payment row |

### Order fields updated after sync

| Order field | After refund |
|-------------|--------------|
| `payment_status` / `user_payment_status` | e.g. `partially_refund`, `refund` |
| `customer_paid_amount` | Sum of `completed` customer payments |
| `customer_refunded_amount` | Sum of `refunded` customer payments |
| `customer_net_paid` | completed − refunded |
| `customer_due_amount` | `total_price − customer_net_paid` |
| `is_paid` | `true` only when status is `paid` |
| `partner_payment_status`, `partner_paid_amount`, `partner_due_amount` | Recalculated |

**`order_status`:** Set to **`refunded`** automatically on create (partial or full refund). Service lines (non-cancelled) also move to **`refunded`**.

**Not updated:** `admin_earning`.

---

## Refund amount basis

- **Cap:** `refund_amount` ≤ **customer net paid** (`completed` customer payments − `refunded` rows).
- **Not capped by** `order.total_price`. Example: order total ₹10,000, customer paid ₹3,000 → max refund **₹3,000**.

---

## Recommended test flow (Postman)

1. **Eligible orders** — copy `_id` → `orderId` (or use collection test script).
2. **Create** — set `refund_amount` ≤ row `refundable_amount`; split must sum to refund amount.
3. **Get all** — verify new row; copy `_id` → `refundMongoId`.
4. **Get by id** — detail view.

---

## Order detail & list

`GET /api/order/get/:id` and `GET /api/order/getAll` include **`refunds`** on each order (array of `order_refund` records, newest first, same shape as refund getAll rows).

**`GET /api/order/getAll`** also includes **`refund_summary`** per row: `refund_count`, `total_refunded_amount`, `refundable_amount`, `customer_paid_amount`, `partner_payable_amount`, `admin_payable_amount`, `total_from_partner_wallet`, `total_from_admin_commission`.

Order-level payment rollups (`customer_refunded_amount`, `customer_net_paid`, `payment_status`) remain on the order root.

---

## Related modules

- Customer payments: `/api/order-payment/*`
- Partner wallet: `/api/partner_payout/*` — [PARTNER_PAYOUT_FRONTEND.md](./PARTNER_PAYOUT_FRONTEND.md)
- Financial order grid: `/api/order/financial-payments/*` — [FINANCIAL_ORDER_PAYMENTS_API.md](./FINANCIAL_ORDER_PAYMENTS_API.md)

---

## Planned product changes (not implemented yet)

- Auto-compute `refund_amount` = full customer net paid
- Auto-compute split: partner = order wallet credits; admin = remainder (incl. tax)
- Allow negative partner wallet on refund
- Reduce admin earnings / dashboard revenue on refund

Current API behavior is documented above.
