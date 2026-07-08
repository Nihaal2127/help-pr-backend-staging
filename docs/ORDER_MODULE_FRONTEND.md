# Orders module — frontend integration guide

This document describes the **order**, **order line item (order_service)**, **additional charges**, **order payments**, and **Razorpay** integration in `help-pr-backend-staging`. Share it with frontend developers together with:

- **`postman/Help-PR-All-APIs.postman_collection.json`** — import this single collection (folders **Order**, **Order additional charges**, **Order payments**)
- Source snapshots (merge inputs): `postman/archive/Help-PR-Orders-Module.postman_collection.json`, `postman/archive/Help-PR-Order-Charges-Payments.postman_collection.json`

> **Recent `getAll` changes:** See **`docs/ORDER_GETALL_API_CHANGES.md`** for role scope, date filters, search, and list response updates (aligned with quote `getAll`).

---

## 1. Base URL and authentication

| Item | Detail |
|------|--------|
| **API root** | `{baseUrl}/api/...` (e.g. `https://your-api.example.com`) |
| **Auth** | JWT in header: `Authorization: Bearer <token>` |
| **Token source** | User login response (`generateAuthToken`); payload includes `id` (Mongo user `_id`) used for access checks on financial sub-routes |

All order, order-service, additional-charge, and order-payment routes listed below require **`authMiddleware`** except Razorpay webhook/callback.

---

## 2. High-level architecture

```text
Order (1) ──has──▶ service_items[] ──▶ OrderService (1 per order for new flows)
     │
     ├──▶ OrderAdditionalCharge[]  (extra fees; summed into order total)
     └──▶ OrderPayment[]             (customer vs partner payment rows; optional ledger)
```

- **Order** holds customer-facing totals, payment flags, quote-aligned fields (partner, franchise, schedule, etc.), and references **`order_service`** documents via **`service_items`** (array of ObjectIds; **length must be 1** on create).
- **OrderService** holds per-job execution fields (partner, service window, line pricing, **`is_paid`**, etc.). Partner remittance uses **`order.partner_*`** rollups and **`/api/partner_payout`** (wallet).
- **`total_price`** is **calculated on the server** from `total_service_charge`, service table rates, taxed additional charges, and discount (see §5). Optional client mirrors are compared; **server values are always saved**.

---

## 3. Order status and service status

**Order `order_status`** and **OrderService `service_status`** are stored as **strings** (not numbers):

| `order_status` / `service_status` | Meaning |
|-----------------------------------|---------|
| `in-progress` | Default when an order is created |
| `completed` | Job finished |
| `cancelled` | Order or line cancelled; **`customer_due_amount`** and **`partner_due_amount`** become **0** (payment rows unchanged) |
| `refunded` | Order refunded |

**`order_status_info`** — timeline array with one entry per status (`status` string + `updated_at`). On create, only `in-progress` has a timestamp.

**Update order** (`PUT /api/order/update/:id`): pass `order_status` as a string. **`completed`** is allowed only when the customer has paid the full **`total_price`** (`payment_status` = `paid`, i.e. completed customer `order_payment` rows sum to total due, ±₹0.01). Otherwise the API returns **409**. Other transitions (e.g. `in-progress` → `cancelled`, `completed` → `refunded`) are unchanged.

**Reprice on update** (optional, same endpoint): send **`total_service_charge`** and/or **`offer_id`**. Server keeps **`tax_percent`**, **`commission_percent`**, **`minimum_deposit_percent`** from the saved order; recalculates **`commission_amount`**, **`tax_amount`**, **`total_price`**, etc. Offer rows are **replaced** from the live **`offers`** table (not merged with old `order_offer`). Send **`offer_id`: `null`** to remove an offer.

---

## 4. Main order document (fields frontend should know)

### Identity and parties

| Field | Type | Notes |
|-------|------|--------|
| `unique_id` | string | Human-readable order number (generated) |
| `user_id` | ObjectId | Customer |
| `user_unique_id` | string | Denormalized customer code |
| `partner_id` | ObjectId | Primary partner (mirrors quote; also on line item) |
| `employee_id` | ObjectId | Optional |
| `franchise_id` | ObjectId | Optional |
| `created_by_id` | ObjectId | Who created the order |
| `type` | number | Default `2` |
| `city_id`, `category_id` | ObjectId | Required for typical flows |
| `service_id` | ObjectId | Optional denormalized service |
| `address` | string | Display / legacy snapshot |
| `address_id` | ObjectId | Optional link to `address` |

### Schedule (quote-aligned, order-level)

| Field | Notes |
|-------|--------|
| `from_date`, `to_date` | Calendar dates — API responses use **`YYYY-MM-DD`** (not full ISO datetime) |
| `work_hours_per_day`, `total_work_hours` | Numbers |
| `work_start_time`, `work_end_time` | Strings |
| `service_price` | Mirror / base service price |
| `order_date` | Fitting / primary date — responses: **`YYYY-MM-DD`** |
| `customer_description`, `rejection_reason` | Text (legacy / extra customer notes) |
| **`order_description`** | Free-text summary of the job — same role as **`quote.quote_description`** on quotes |
| **`admin_description`** | Optional internal admin notes (`null` when unset). Editable by super admin, staff, franchise admin, or franchise employee (scoped). Hidden from customer/partner mobile APIs. |
| **`quote_id`** | Reference to **`quote`** when the order was created from a quote (**`convertToOrder`** sets this); populated in **`GET /api/order/get/:id`** as **`quote_info`** |

### Money and payment (order-level)

| Field | Notes |
|-------|--------|
| `total_service_charge` | **Required on create** — base service amount for booked hours (frontend). Alias: `service_price`. |
| `commission_percent`, `commission_amount` | Snapshotted from `service.commission` (%); amount = charge × commission% |
| `sub_total` | `total_service_charge + commission_amount` (before tax) |
| `tax_percent`, `tax_amount` | Snapshotted from `service.tax` (%); tax on **(sub_total − discount)** |
| `minimum_deposit_percent`, `minimum_deposit_amount` | From `service.minimum_deposit` (%); amount = **final** `total_price` × % |
| `discount_amount`, `discount_percent`, `discount_code`, `discount_reason` | Set by server when **`offer_id`** applied (`discount_amount` = offer `total_discount`) |
| `offer_id`, `order_offer_id` | Optional offer on create; see **`order_offer`** snapshot on GET detail |
| `additional_charges_subtotal`, `additional_charges_commission`, `additional_charges_tax`, `additional_charges_total` | **Maintained by server** — per charge: `commission` on `amount`, then `tax` on `(amount + commission)`; customer pays line `total_amount`; partner wallet entitlement includes **`additional_charges_subtotal` base only** (see partner payout doc) |
| `admin_commission` | Same as `commission_amount` (reporting) |
| `admin_earning` | Defaults to `commission_amount` if omitted on create |
| `total_price` | **Server-calculated** (see §5); client values compared, server wins on mismatch |
| `min_deposit` | Legacy alias of `minimum_deposit_amount` |
| `user_paltform_fee`, `partner_commison_platform_fee` | Legacy; new orders set platform fee **0**, partner fee = `commission_amount` |
| **`user_payment_status`** | **Use on frontend** — customer payment rollup: `unpaid` \| `paid` \| `partially_paid` \| `refund` \| `partially_refund` (from customer `order_payment` rows) |
| `payment_status` | Same as `user_payment_status` (kept for older clients) |
| **`partner_payment_status`** | **Use on frontend** — partner remittance rollup: `unpaid` \| `partially_paid` \| `paid` (completed partner `order_payment` vs `customer_net_paid` allowance) |
| `customer_paid_amount`, `customer_refunded_amount`, `customer_net_paid`, `customer_due_amount` | Customer breakdown; updated on sync |
| `partner_paid_amount`, `partner_due_amount` | Completed partner payments sum; remaining remittance allowance |
| `is_paid` | **Derived** — `true` only when `user_payment_status === paid` (legacy filters) |
| `payment_mode_id`, `transaction_id` | Legacy + Razorpay link id |
| `payment_schedule_type` | `"single"` \| `"installments"` |
| `customer_payment_method` | Label, e.g. cash / upi / card / online / bank_transfer / other |

---

## 5. How `total_price` is calculated

**On create**, the server loads the global **`service`** by `service_id`, snapshots `tax`, `commission`, and `minimum_deposit` percentages, and computes:

```text
commission_amount   = total_service_charge × commission% / 100
sub_total           = total_service_charge + commission_amount
discount_amount     = offer total_discount (optional)
taxable_subtotal    = sub_total − discount_amount
tax_amount          = taxable_subtotal × tax% / 100
```

**After create** and whenever additional charges change, **`recalculateOrderTotals`** runs:

```text
per additional charge: commission_amount = amount × commission_percent / 100
                       charge_tax      = (amount + commission_amount) × tax_percent / 100
                       charge_total    = amount + commission_amount + charge_tax

total_price = taxable_subtotal + tax_amount + sum(charge_total)
minimum_deposit_amount = total_price × minimum_deposit_percent / 100
```

Optional client breakdown fields are **compared**; on mismatch the **server values are saved** and `pricing_mismatch: true` is returned on create.

Result is clamped to **≥ 0**.

**Razorpay payment link** (`payment_mode_id === "2"`): the amount sent to Razorpay is **`total_price` after** the in-memory compute at create time; after save, **`recalculateOrderTotals`** runs again (same if no extra charges yet).

---

## 6. HTTP API reference

Prefix **`/api/order`** unless noted.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/order/create` | Create order + exactly one `order_service` |
| GET | `/api/order/get/:id` | Full order detail (populated + `additional_charges` + `order_payments`) |
| GET | `/api/order/getAll` | Paginated list — see **getAll query parameters** below |
| GET | `/api/order/getCustomerOrder` | Customer orders — **query** `user_id` required |
| PUT | `/api/order/update/:id` | Update `order_status` and/or **reprice** via `total_service_charge` / `offer_id` — **do not** set `is_paid` manually |
| PUT | `/api/order/serviceUpdate/:orderServiceId` | Update line item fields (see middleware) |
| PUT | `/api/order/cancleService/:orderId` | Cancel one line — body `service_items_id` |
| PUT | `/api/order/cancle/:id` | Cancel whole order — body `cancellation_reasone` |
| DELETE | `/api/order/delete/:id` | Soft-delete order (`deleted_at`) |

#### `GET /api/order/getAll` query parameters

**Access:** Super admin, staff, franchise admin, franchise employee only. Partner / customer → **403** (use `getCustomerOrder` for customers). **`franchise_id`** is role-scoped like quotes — see **`docs/ORDER_GETALL_API_CHANGES.md`**.

| Parameter | Description |
|-----------|-------------|
| `page`, `limit` | Pagination (defaults 1, 10) |
| `order_status` | `in-progress` \| `completed` \| `cancelled` \| `refunded`; invalid → **409** |
| `is_paid` | `true` / `false` |
| **`search`** | Free-text (sanitized) — order fields, linked quote, users, category, **service**, city, franchise |
| `keyword` | Legacy alias for `search` |
| **`from_date`**, **`to_date`** | ISO dates. **One alone** = that UTC calendar day; **both** = schedule overlap (+ `order_date` fallback). Invalid → **409** |
| **`sort_by`** | `created_at`, `updated_at`, `order_date`, `order_status`, `total_price`, `sub_total`, `unique_id`, `is_paid`, `tax`, `min_deposit`, `order_description` |
| **`sort_order`** | `asc` or `desc` |
| `sort` | Legacy: **`1`** = ascending, else descending |
| `user_id`, `partner_id`, `employee_id`, `franchise_id`, `city_id`, `category_id`, **`service_id`** | Optional ObjectId filters |

List responses use **case-insensitive collation** for sort. Each record includes display names and **hydrated** `user_id`, `partner_id`, `category_id`, `service_id`, `franchise_id`, `address_id`, `quote_id` objects (quote list parity).

**`GET /api/order/get/:id`** enforces the same franchise access rules as the list.

> **Note:** `getCustomerOrderDetails` exists in `order_controller.js` but is **not** registered on `order_routes.js` today. Use **`GET /api/order/get/:id`** (or wire the handler if you need SOS-style `unique_id` lookup separately).

### Additional charges — `/api/order-additional-charges`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/create` | Body: `order_id`, `amount`, optional `label`, `description`, `payment_method`, `charge_type` |
| GET | `/by-order/:orderId` | List charges for an order |
| PUT | `/update/:id` | Update a charge; **recalculates order total** |
| DELETE | `/delete/:id` | Soft-delete; **recalculates order total** |

**`payment_method`** (additional charge): `cash` \| `upi` \| `card` \| `online` \| `bank_transfer` \| `other` (invalid values stored as `other`).

**Authorization:** caller JWT `id` must match **`order.user_id`**, **`order.partner_id`**, **`order.created_by_id`**, or **`order.employee_id`**. Otherwise **403**.

### Order payments — `/api/order-payments`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/create` | Ledger row: `order_id`, `payer_type` (`customer` \| `partner`), `amount`, optional fields. **`payment_method: online`** (customer only) → **202** + `record.payment_url` |
| GET | `/payment-status/:id` | Poll Razorpay for pending online payment; sync if webhook missed |
| GET | `/by-order/:orderId` | Optional query `payer_type` |
| PUT | `/update/:id` | Update status, amounts, references, etc. |
| DELETE | `/delete/:id` | Soft-delete |

**`payer_type`:** `customer` = money collected from the customer; `partner` = payment **to** the partner (credits partner wallet when `status` is `completed`).

**Partner payments (`payer_type: partner`, `status: completed`):**

- Allowed only after the customer has paid something on the order (`customer_net_paid` &gt; 0 from completed customer `order_payment` rows).
- **Cumulative** completed partner payments on the same order cannot exceed **`customer_net_paid`** (money collected from the customer minus refunds).
- **Cumulative** completed partner payments cannot exceed order partner entitlement (`partner_earning` + base `additional_charges_subtotal` on the order).
- `pending` / `failed` partner rows are not validated or wallet-credited until marked `completed`.
- On nested create/update, **customer** payment rows are processed **before** partner rows in the same request.

**`status`:** `pending` \| `completed` \| `failed` \| `refunded`. After any change, server runs **`syncOrderPaymentStatus`** on the order.

### Customer payment status (on `order`) — `user_payment_status`

| `user_payment_status` | When |
|-----------------------|------|
| `unpaid` | No customer `order_payment` rows |
| `paid` | Sum of **completed** customer payments ≥ `order.total_price` (±₹0.01) |
| `partially_paid` | Some **completed** payment, net collected &lt; total due |
| `refund` | **Refunded** amount covers all completed payments or full order value |
| `partially_refund` | Some refund recorded, not a full refund |

`payment_status` is kept equal to `user_payment_status` for older clients.

Only **`payer_type: customer`** rows count. **`order.total_price`** includes additional charges. Pending/failed payments do not count as paid.

**Synced when:** customer `order_payment` create/update/delete, nested payments on order update, refunds, Razorpay webhook, and **`recalculateOrderTotals`** (additional charges change `total_price`).

### Partner payment status (on `order`) — `partner_payment_status`

| `partner_payment_status` | When |
|--------------------------|------|
| `unpaid` | No **completed** partner payments, or `customer_net_paid` is 0 |
| `partially_paid` | Some **completed** partner payments, sum &lt; `customer_net_paid` |
| `paid` | Sum of **completed** partner payments ≥ `customer_net_paid` (±₹0.01) |

Also on the order: **`partner_paid_amount`** (sum paid to partner so far), **`partner_due_amount`** (remaining payable to partner from collections: `customer_net_paid − partner_paid_amount`).

Only **`payer_type: partner`** rows with **`status: completed`** count. Ceiling is **`customer_net_paid`** (not `total_price`).

**Synced when:** same triggers as customer status (any `order_payment` or total change runs **`syncOrderPaymentStatus`**).

Same **403** participant rule as additional charges.

### Order line items — `/api/order_service`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/getAll` | Paginated filters: `user_id`, `partner_id`, `service_status`, `is_paid`, `unique_id` (matches **`order_unique_id`**), `search`, `page`, `limit`, `sort` |
| GET | `/get/:id` | Single `order_service` |

### Razorpay — `/api/razorpay`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/razorpayWebhook` | **Server-to-server** (Razorpay); creates **completed** customer `order_payment`, syncs **`payment_status`** |
| GET | `/callback` | Browser redirect success page |

Frontend normally only opens **`payment_url`** returned from order create when `payment_mode_id === "2"`.

### Mobile customer — Razorpay online payments

Same pattern as partner subscription online pay (`docs/SUBSCRIPTION_CHANGE_FRONTEND.md`):

| Step | API |
|------|-----|
| 1 | `POST /api/mobile/user/orders/:orderId/payments` with `payment_method: online`, `amount` > 0 |
| 2 | Open **`record.payment_url`** (HTTP **202**) |
| 3 | `GET /api/mobile/user/orders/:orderId/payments/:paymentId/payment-status` — poll until `data.status` is `completed` |

**Quote deposit:** `POST /api/mobile/user/quotes/:id/convert-to-order` with `payment_method: online` returns **`data.payment.payment_url`** (**202**) without creating an order. Poll **`GET /api/mobile/user/quotes/:id/deposit-payment/:paymentId/payment-status`**; the order is created after Razorpay confirms payment (webhook or poll).

**Resume:** posting the same online amount again while a pending link exists returns the same URL (`resumed: true`).

**Requirements:** customer profile must have **email or phone**. Webhook: `POST /api/razorpay/razorpayWebhook` (see env `RAZORPAY_*`).

**Admin create** (`payment_mode_id === "2"`): order is saved first, then a pending `order_payment` + Razorpay link; response includes `payment_url` and `payment_id`.

### API response date formats (GET list / GET detail / update)

| Field | Response format |
|-------|-----------------|
| `from_date`, `to_date`, `order_date` | **`YYYY-MM-DD`** |
| `service_items[].service_date` | **`YYYY-MM-DD`** |
| `quote_info.from_date`, `quote_info.to_date` | **`YYYY-MM-DD`** |
| `service_from_time`, `service_to_time`, `paid_at`, `due_date`, `created_at` | Full **ISO 8601** datetime (unchanged) |

**Create/update requests** still accept ISO strings or `YYYY-MM-DD`; storage remains `Date` in MongoDB.

---

## 7. Create order — required body (middleware)

Top-level fields validated by **`createOrderMiddleware`** (in addition to **`service_items`** with length **1** via **`checkItemsMiddleware`**):

- `user_id`, `user_unique_id`, `city_id`, `category_id`, `created_by_id`
- `is_paid` (boolean); if `true`, **`transaction_id`** required
- **`order_status`** is not required on create; server sets **`in-progress`** automatically.
- `order_date`, `address` (string)
- **`total_service_charge`** (or **`service_price`**) — base service amount; must be **> 0**
- **`service_id`** on order or on **`service_items[0]`** (used to load `tax`, `commission`, `minimum_deposit` from global **service**)
- `type` — if `type === 1`, **`partner_id`** required on the **service line item**
- Do **not** send `discount_amount` with **`offer_id`** (use offer or manual discount, not both)

**`service_items[0]`** must include: `user_id`, `category_id`, `service_id`, `service_date`, `service_from_time`, `service_to_time`, **`total_service_charge`** (or `service_price`), and **`partner_id`** when `type === 1`.

**Optional `offer_id`**: MongoDB id of an active offer valid on **`order_date`**. Server creates **`order_offer`** row and sets `discount_amount` = `total_discount` (admin + partner contribution amounts). Do **not** send `discount_amount` with `offer_id`.

**Optional pricing mirrors** (compared to server; server wins on mismatch): `commission_amount`, `tax_amount`, `sub_total`, `total_price`, `minimum_deposit_amount`, `discount_amount`.

**Optional order extensions**: `partner_id`, `employee_id`, `franchise_id`, `address_id`, `from_date`, `to_date`, `work_*`, `customer_description`, **`order_description`**, **`admin_description`**, **`quote_id`**, `payment_schedule_type`, `customer_payment_method`, `partner_earning`, `admin_earning`.

**Create response** may include `record.pricing` with `pricing_mismatch`, `saved`, and `mismatches`.

When **`quote_id`** is sent and **`order_description`** is omitted, the server copies **`quote.quote_description`** into **`order_description`** if present.

**Quote conversion:** `POST /api/quote/.../convert` sets **`quote_id`** to the source quote and **`order_description`** from **`quote.quote_description`** (and keeps **`customer_description`** in sync with that text for older clients).

**Razorpay create:** `payment_mode_id === "2"` requires **`name`**, **`email`**, **`contact`** on the body for the payment link.

On create, **`payment_status`** is **`unpaid`** until customer **`order_payment`** rows exist (unless you include completed customer rows in **`order_payments`** below).

### Nested additional charges & payments (create)

Optional arrays on the same **`POST /api/order/create`** body:

```json
{
  "additional_charges": [
    {
      "amount": 150,
      "label": "Transport",
      "description": "Extra visit",
      "payment_method": "upi",
      "charge_type": "transport"
    }
  ],
  "order_payments": [
    {
      "payer_type": "customer",
      "amount": 500,
      "payment_method": "upi",
      "status": "completed",
      "transaction_reference": "UPIREF123",
      "notes": "Deposit"
    }
  ]
}
```

Shorthand: `{ "additional_charges": { "create": [ ... ] } }` — **`update`** / **`delete`** are not allowed on create.

After save, the server creates rows, runs **`recalculateOrderTotals`** (charges affect **`total_price`**), and syncs **`payment_status`**.

**Create response** may include `record.nested` with created ids:

```json
"nested": {
  "additional_charges": { "created": ["..."] },
  "order_payments": { "created": ["..."] }
}
```

Standalone **`/api/order-additional-charges`** and **`/api/order-payments`** routes still work for changes after create.

---

## 8. Update order — fields, status, repricing, nested resources

`PUT /api/order/update/:id` supports (send only fields you are changing):

### Order header

| Body field | Effect |
|------------|--------|
| `user_id` | Customer; updates `user_unique_id` from user record if omitted |
| `user_unique_id` | Denormalized customer code (optional with `user_id`) |
| `partner_id` | Primary partner (`null` to clear) |
| `employee_id` | Assigned employee (`null` to clear) |
| `franchise_id` | Franchise (`null` to clear) |
| `city_id`, `category_id`, `service_id` | Catalog references |
| `address`, `address_id` | Display / linked address |
| `order_date` | Order date |
| `order_description`, `customer_description`, `admin_description` | Text fields (`admin_description`: admin roles only; send `null` to clear) |
| `from_date`, `to_date`, `work_hours_per_day`, `total_work_hours`, `work_start_time`, `work_end_time` | Schedule |
| `payment_schedule_type` | `single` \| `installments` |
| `customer_payment_method` | e.g. `upi`, `cash` |
| `type` | Order type (`1` requires `partner_id`) |

### Status and pricing

| Body field | Effect |
|------------|--------|
| `order_status` | Syncs to non-cancelled/refunded line items. **`completed`** requires customer paid in full (`payment_status` = `paid`) → **409** if not. **`cancelled`** / **`refunded`** clear pending due amounts (`customer_due_amount`, `partner_due_amount` → 0); `order_payment` rows are not changed |
| `total_service_charge` (or `service_price`) | Reprice using **saved** % on the order |
| `offer_id` | Apply/change offer; **`order_offer`** replaced |
| `offer_id: null` | Remove offer |

### Service line (`service_items`)

Array or `{ update: [...] }`. Each item may include `_id` (order_service id); if omitted and the order has **one** line, that line is updated.

| Line field | Effect |
|------------|--------|
| `user_id`, `partner_id`, `category_id`, `service_id` | Line + mirrored order header where applicable |
| `service_date`, `service_from_time`, `service_to_time` | Execution window |
| `service_status` | Line status string |
| `total_service_charge` / `service_price` | Triggers **reprice** when order-level charge not sent |
| `is_paid` | Line-level flag only (order `payment_status` still from ledger) |

### Nested charges & payments

See §7 nested update section below.

**Do not** send `is_paid` on the **order** — it is **derived** from customer payments (see §6).

**Reprice response** (when charge or offer changes): includes `pricing` object and `order_offer` when applicable.

```text
commission_amount = total_service_charge × order.commission_percent / 100
sub_total           = total_service_charge + commission_amount
(then offer discount, then tax on taxable subtotal — same as create)
```

### Nested additional charges & payments (update)

Optional on the same **`PUT /api/order/update/:id`** — object form (recommended):

```json
{
  "order_status": "completed",
  "additional_charges": {
    "create": [{ "amount": 100, "label": "Materials" }],
    "update": [{ "_id": "CHARGE_OBJECT_ID", "amount": 200 }],
    "delete": ["CHARGE_OBJECT_ID_TO_REMOVE"]
  },
  "order_payments": {
    "create": [
      {
        "payer_type": "customer",
        "amount": 1000,
        "status": "completed",
        "payment_method": "upi"
      }
    ],
    "update": [{ "_id": "PAYMENT_OBJECT_ID", "status": "completed" }],
    "delete": []
  }
}
```

**Array shorthand** (append-only): `"additional_charges": [{ "amount": 50 }]` → treated as **`create`** only (no update/delete).

Processing order: **delete → update → create** for each resource. Charges trigger **`recalculateOrderTotals`**; payments-only changes trigger **`syncOrderPaymentStatus`**.

**Update response** may include `nested` with `created` / `updated` / `deleted` id lists per resource.

---

## 9. Get order by id — response shape

`GET /api/order/get/:id` returns **`record`** with:

- Flat order fields + populated **`user_info`**, **`city_info`**, **`category_info`**, **`partner_info`**, **`employee_info`**, **`franchise_info`**, **`address_info`**, **`service_info`**, **`quote_info`** (when `quote_id` is set)
- **`service_items`**: each element includes **`service_info`** and optional **`partner_info`**
- **`additional_charges`**: array from `order_additional_charge`
- **`order_payments`**: array from `order_payment`
- **`order_offer`**: offer snapshot (`total_discount`, contribution breakdown) when an offer was applied
- **`refunds`**: array of `order_refund` rows for this order (newest first) — see **`docs/REFUND_API.md`**

**`GET /api/order/getAll`** includes **`refunds`** and **`refund_summary`** (rollup: `total_refunded_amount`, `refundable_amount`, `partner_payable_amount`, `admin_payable_amount`, etc.) on each list row.

---

## 10. Postman

Import **`postman/Help-PR-All-APIs.postman_collection.json`** only (see `postman/README.md`).

### Core orders — folder **Order**

| # | Request | Route |
|---|---------|--------|
| 1 | Get all orders | `GET /api/order/getAll` (all query params on one request) |
| 2 | Get order by id | `GET /api/order/get/:id` |
| 3 | Create order | `POST /api/order/create` |
| 4 | Update order | `PUT /api/order/update/:id` |
| 5 | Soft-delete order | `DELETE /api/order/delete/:id` |

Variables: `baseUrl`, `accessToken`, `orderId`, `orderServiceId`, filter vars (`search`, `from_date`, `to_date`, `orderStatus`, `paymentStatus`, `franchiseId`, etc.), `offerId`.

### Charges & payments — folders **Order additional charges** / **Order payments**

Standalone CRUD for `/api/order-additional-charges` and `/api/order-payments` (optional if you use nested payloads on create/update). Variables: `orderId`, `additionalChargeId`, `orderPaymentId`.

Other routes (`serviceUpdate`, `cancle`, `getCustomerOrder`, `order_service`, `order/financial-payments`, `partner_payout`, `getCount`, Razorpay) are in the same All APIs collection or documented in §6.

Replace placeholder ObjectIds in example bodies with real IDs from your environment.

---

## 11. Offers (`order_offer`)

When **`offer_id`** is sent on create (percentage offer):

```text
admin_contribution_amount   = commission_amount × offer.admin_contribution%
partner_contribution_amount = total_service_charge × offer.partner_contribution%
total_discount              = admin_contribution_amount + partner_contribution_amount
taxable_subtotal            = sub_total − total_discount
tax_amount                  = taxable_subtotal × service tax%
total_price                 = taxable_subtotal + tax_amount
```

`order.discount_amount` = `order_offer.total_discount`. `discount_code` = offer `unique_id`; `discount_reason` = offer name.

Offers are **optional** — omit `offer_id` and creation behaves as before (no `order_offer` row, `discount_amount` null unless legacy manual discount).

## 12. Known limitations (for backlog)

- Manual **`discount_amount`** without **`offer_id`** still supported but prefer offers for auditable splits.
- Existing DB rows may still have **numeric** `order_status` until a migration is run — see **`docs/ORDER_STATUS_MIGRATION.md`**.
- Razorpay webhook signature uses JSON body hashing; confirm against Razorpay’s latest raw-body guidance for production.
- Staff who are not `user_id` / `partner_id` / `created_by_id` / `employee_id` on the order cannot hit charge/payment APIs unless you add a role bypass.

---

## 13. Related code (for backend readers)

| Area | Path |
|------|------|
| Order model | `models/order.js` |
| Order offer model | `models/order_offer.js` |
| Order service model | `models/order_services.js` |
| Additional charge model | `models/order_additional_charge.js` |
| Payment status enum | `enum/order_payment_status_enum.js` |
| Reprice on update | `services/order_update_pricing_service.js` |
| Sync payment status | `services/order_payment_status_service.js` |
| Order payment model | `models/order_payment.js` |
| Totals helper | `utils/order_financials.js` |
| List/detail franchise access & participant check | `utils/order_access.js` (`resolveOrderListScope`, `assertOrderRecordAccess`, `callerMatchesOrderParticipant`) |
| Controllers | `controllers/order_controller.js`, `order_service_controller.js`, `order_additional_charge_controller.js`, `order_payment_controller.js`, `razorpay_controller.js` |
| Routes | `routes/order_routes.js`, `order_service_routes.js`, `order_additional_charge_routes.js`, `order_payment_routes.js`, `razorpay_routes.js` |
