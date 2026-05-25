# Financial — Order Payments API (order-derived)

**Date:** May 2026  
**Source of truth:** `order` collection (+ `order_service` line for service date / partner earning).  
Financial overview is **order-derived** only (`/api/order/financial-payments/*`). The old `/api/financial-order` module and `financial_order` collection were removed.

---

## Postman

Import **`postman/Help-PR-All-APIs.postman_collection.json`** → folder **`23A — Financial order payments`**.

Also: **`postman/Help-PR-Financial-Order-Payments.postman_collection.json`** (standalone).  
Dashboard only: **`02 — getCount`** → **getCount — financials (order payments)**.


---

## 1. Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/order/financial-payments/getAll` | Paginated financial overview for every order |
| `GET` | `/api/order/financial-payments/get/:id` | Single order by Mongo `_id` |
| `POST` | `/api/getCount` | Dashboard cards — `type` **4** (see §4) |

**Auth:** `Authorization: Bearer <JWT>`  
**Access:** Same as `GET /api/order/getAll` (super admin / staff all; franchise admin / employee scoped).

---

## 2. List — `GET /api/order/financial-payments/getAll`

### Query parameters

| Param | Description |
|-------|-------------|
| `page` | Page number (default `1`) |
| `limit` | Page size (default `10`) |
| `franchise_id` | Filter by franchise (super admin / staff) |
| `search` | Free-text filter: `order_unique_id`, customer name, partner name, service name (same param name as other list APIs) |
| `order_status` | `in_progress` \| `completed` \| `in-progress` \| `cancelled` \| `refunded` |
| `customer_payment_status` | Alias: `user_payment_status`, `payment_status` — `unpaid`, `paid`, `partially_paid`, `refund`, `partially_refund` |
| `partner_payment_status` | `unpaid`, `partially_paid`, `paid` |
| `user_id`, `partner_id`, `service_id` | ObjectId filters |
| `from_date`, `to_date` | Order schedule / `order_date` (same rules as order getAll) |
| `sort_by` | `user_name`, `partner_name`, `service_name`, `service_date`, `created_at`, `order_date`, `total_price`, `order_unique_id` |
| `sort_order` | `asc` \| `desc` |

### Example request

```http
GET /api/order/financial-payments/getAll?page=1&limit=20&order_status=completed&franchise_id=REPLACE_FRANCHISE_OID
Authorization: Bearer <token>
```

### Example response (`records[]` — one object per order)

```json
{
  "success": true,
  "status": 200,
  "message": "Financial order payments fetched successfully.",
  "source": "order",
  "totalItems": 42,
  "totalPages": 3,
  "currentPage": 1,
  "records": [
    {
      "sr_no": 1,
      "_id": "664a1b2c3d4e5f6789012345",
      "order_unique_id": "ORD-00042",
      "order_id": "664a1b2c3d4e5f6789012345",
      "franchise_id": "664a00000000000000000001",
      "user_id": "664a00000000000000000002",
      "user_name": "Jane Customer",
      "partner_id": "664a00000000000000000003",
      "partner_name": "Raj Partner",
      "service_name": "Home Cleaning",
      "service_date": "2026-06-01",
      "total_amount": 3540,
      "total_price": 3540,
      "commission_percentage": 10,
      "commission_amount": 300,
      "tax_percentage": 18,
      "tax_amount": 540,
      "customer_paid_amount": 2000,
      "customer_pending_amount": 1540,
      "total_service_amount": 3000,
      "total_partner_amount": 2700,
      "paid_to_partner": 1000,
      "pending_to_partner": 1700,
      "customer_payment_status": "partially_paid",
      "partner_payment_status": "partially_paid",
      "order_status": "in_progress",
      "order_status_canonical": "in-progress",
      "created_at": "2026-05-10T08:00:00.000Z",
      "updated_at": "2026-05-15T12:00:00.000Z"
    }
  ]
}
```

### Field mapping (UI column → API key)

| UI column | API field | Order source |
|-----------|-----------|--------------|
| SR No | `sr_no` | Row index on current page |
| Order ID | `order_unique_id` | `order.unique_id` |
| User Name | `user_name` | Customer user `name` |
| Partner Name | `partner_name` | Partner user `name` |
| Service Name | `service_name` | Service `name` |
| Service Date | `service_date` | `order_service.service_date` or `order.order_date` |
| Total Amount | `total_amount` / `total_price` | `order.total_price` |
| Commission (%) | `commission_percentage` | `order.commission_percent` |
| Commission amount | `commission_amount` | `order.commission_amount` |
| Tax (%) | `tax_percentage` | `order.tax_percent` |
| Tax amount | `tax_amount` | `order.tax_amount` |
| Customer Paid Amount | `customer_paid_amount` | `order.customer_paid_amount` |
| Customer Pending Amount | `customer_pending_amount` | `order.customer_due_amount` (always **0** when `order_status` is `cancelled` or `refunded`) |
| Total Partner Amount | `total_partner_amount` | `order_service.partner_earning` + `order.additional_charges_subtotal` |
| Paid to Partner | `paid_to_partner` | `order.partner_paid_amount` |
| Pending to Partner | `pending_to_partner` | `total_partner_amount − paid_to_partner` (**0** when `order_status` is `cancelled` or `refunded`) |
| Customer Payment Status | `customer_payment_status` | `order.user_payment_status` |
| Partner Payment Status | `partner_payment_status` | `unpaid` / `partially_paid` / `paid` vs `total_partner_amount` |
| Order status | `order_status` | `in-progress` → `in_progress`; see `order_status_canonical` |

---

## 3. Detail — `GET /api/order/financial-payments/get/:id`

`:id` = order Mongo `_id` (same as `order_id` in list).

```http
GET /api/order/financial-payments/get/664a1b2c3d4e5f6789012345
Authorization: Bearer <token>
```

Response: `{ "success": true, "source": "order", "record": { ...same shape as list row, "sr_no": 1 } }`

---

## 4. Dashboard counts — `POST /api/getCount` type 4

```json
{
  "type": "financial-order-payments",
  "franchise_id": "OPTIONAL_FRANCHISE_OID"
}
```

Aliases: `financials`, `order-payment`, `financial_order_payments` → type **4**.

**Record keys** (unchanged for UI):

| Key | Meaning |
|-----|---------|
| `total_completed_orders` | Orders with status completed |
| `total_in_progress_orders` | Orders in progress |
| `total_partner_pending_amount` | Sum of per-order partner pending (same rule as list `pending_to_partner`; **0** for cancelled/refunded) |
| `total_user_pending_amount` | Sum of per-order customer pending (stored `customer_due_amount`; **0** for cancelled/refunded) |

---

## 5. Recording payments (no financial_order writes)

Use the **order module**:

- **Create order + payments:** `POST /api/order/create` with nested `order_payments`
- **Update:** `PUT /api/order/update/:id` with `order_payments: { create, update, delete }`
- **Standalone payment line:** `POST /api/order-payments` (see order-payments routes)

Customer/partner amounts and statuses on the overview update automatically via `syncOrderPaymentStatus`.

**Partner wallet (separate module):** This API does not read `partner_wallet_ledger`. Wallet credits are created when **completed** `payer_type: partner` rows are recorded (`/api/order-payments`), capped by **partner entitlement** (`partner_earning` + base `additional_charges_subtotal`, not tax/commission on extras) and by **`customer_net_paid`**. See `docs/PARTNER_PAYOUT_FRONTEND.md`.

---

## 6. Migration notes for frontend

1. Use **`/api/order/financial-payments/*`** for list and detail.
2. Use **`order_id` / `_id`** from list for detail — not a separate financial document id.
3. Record payments via **`/api/order`** and **`/api/order-payments`** only.
4. Keep **`POST /api/getCount` type 4** — order-backed dashboard cards.
