# Orders module — frontend integration guide

This document describes the **order**, **order line item (order_service)**, **additional charges**, **order payments**, and **Razorpay** integration in `help-pr-backend-staging`. Share it with frontend developers together with the Postman collection **`postman/Help-PR-Orders-Module.postman_collection.json`**.

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
- **OrderService** holds per-job execution fields (partner, service window, line pricing, **`is_paid`**, **`partner_paid_status`**, etc.).
- **`total_price`** on the order is **recalculated** server-side from base amounts + additional charges − discount (see §5). The **`total_price`** sent on create is validated by middleware but **overwritten** to match the server formula after save.

---

## 3. Order status and service status

**Order `order_status`** and **OrderService `service_status`** are stored as **strings** (not numbers):

| `order_status` / `service_status` | Meaning |
|-----------------------------------|---------|
| `in-progress` | Default when an order is created |
| `completed` | Job finished |
| `cancelled` | Order or line cancelled |
| `refunded` | Order refunded |

**`order_status_info`** — timeline array with one entry per status (`status` string + `updated_at`). On create, only `in-progress` has a timestamp.

**Update order** (`PUT /api/order/update/:id`): pass `order_status` as a string; any valid transition is allowed (e.g. `in-progress` → `completed`, `completed` → `refunded`).

**Partner payout field** on **`order_service`**: **`partner_paid_status`** — `1` Pending, `2` Paid, `3` return (per existing comment).

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
| `from_date`, `to_date` | Dates |
| `work_hours_per_day`, `total_work_hours` | Numbers |
| `work_start_time`, `work_end_time` | Strings |
| `service_price` | Mirror / base service price |
| `order_date` | Fitting / primary date |
| `customer_description`, `rejection_reason` | Text (legacy / extra customer notes) |
| **`order_description`** | Free-text summary of the job — same role as **`quote.quote_description`** on quotes |
| **`quote_id`** | Reference to **`quote`** when the order was created from a quote (**`convertToOrder`** sets this); populated in **`GET /api/order/get/:id`** as **`quote_info`** |

### Money and payment (order-level)

| Field | Notes |
|-------|--------|
| `sub_total`, `tax` | Base components |
| `discount_amount`, `discount_percent`, `discount_code`, `discount_reason` | Discounts; **only `discount_amount` affects `total_price`** in the current helper |
| `user_paltform_fee`, `partner_commison_platform_fee` | Fees (spelling matches API) |
| `additional_charges_total` | **Maintained by server** when additional charges change |
| `admin_commission` | Reporting; **not** subtracted from `total_price` in current formula |
| `admin_earning` | As before |
| `total_price` | **Recalculated** (see §5) |
| `min_deposit` | Stored; not in total formula yet |
| `is_paid`, `payment_mode_id`, `transaction_id` | Legacy + Razorpay link id |
| `payment_schedule_type` | `"single"` \| `"installments"` |
| `customer_payment_method` | Label, e.g. cash / upi / card / online / bank_transfer / other |

---

## 5. How `total_price` is calculated

After create and whenever additional charges are added/updated/removed, the server runs **`recalculateOrderTotals`**:

```text
total_price = sub_total + tax + user_paltform_fee + partner_commison_platform_fee
              + sum(order_additional_charge.amount for non-deleted rows)
              − discount_amount   (treated as 0 if null/undefined)
```

Result is clamped to **≥ 0**. **`admin_commission`** does not change this total in the current implementation.

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
| PUT | `/api/order/update/:id` | Update `order_status`, `is_paid` (and sync `is_paid` to non-cancelled line items) |
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
| POST | `/create` | Ledger row: `order_id`, `payer_type` (`customer` \| `partner`), `amount`, optional fields |
| GET | `/by-order/:orderId` | Optional query `payer_type` |
| PUT | `/update/:id` | Update status, amounts, references, etc. |
| DELETE | `/delete/:id` | Soft-delete |

**`payer_type`:** `customer` = money from/to customer context; `partner` = partner-side / payout context (business meaning is up to product).

**`status`:** `pending` \| `completed` \| `failed` \| `refunded`.

Same **403** participant rule as additional charges.

### Order line items — `/api/order_service`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/getAll` | Paginated filters: `user_id`, `partner_id`, `service_status`, `is_paid`, `partner_paid_status`, `unique_id` (matches **`order_unique_id`**), `keyword`, `page`, `limit`, `sort` |
| GET | `/get/:id` | Single `order_service` |
| POST | `/payComission` | Body: `order_service_ids` (array), `partner_paid_status` (1–3) |

### Razorpay — `/api/razorpay`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/razorpayWebhook` | **Server-to-server** (Razorpay); signs `payment_link.paid`, sets order + line items **`is_paid`** |
| GET | `/callback` | Browser redirect success page |

Frontend normally only opens **`payment_url`** returned from order create when `payment_mode_id === "2"`.

---

## 7. Create order — required body (middleware)

Top-level fields validated by **`createOrderMiddleware`** (in addition to **`service_items`** with length **1** via **`checkItemsMiddleware`**):

- `user_id`, `user_unique_id`, `city_id`, `category_id`, `created_by_id`
- `is_paid` (boolean); if `true`, **`transaction_id`** required
- **`order_status`** is not required on create; server sets **`in-progress`** automatically.
- `order_date`, `address` (string)
- `sub_total`, `tax`, `user_paltform_fee`, `partner_commison_platform_fee`, `admin_earning`, `total_price` (prices validated)
- `discount_amount` optional
- `type` — if `type === 1`, **`partner_id`** required on the **service line item**

**`service_items[0]`** must include (among others validated): `user_id`, `category_id`, `service_id`, `service_date`, `service_from_time`, `service_to_time`, price fields (`sub_total`, `tax`, `service_price`, fees, `partner_earning`, `total_price`, `admin_earning`), and **`partner_id`** when `type === 1`.

**Optional order extensions** (stored if sent): `partner_id`, `employee_id`, `franchise_id`, `address_id`, `service_id`, `from_date`, `to_date`, `work_*`, `service_price`, `customer_description`, **`order_description`**, **`quote_id`** (must reference a non-deleted quote with no `order_id` yet and not already used on another order), `rejection_reason`, `admin_commission`, `discount_percent`, `discount_code`, `discount_reason`, `min_deposit`, `payment_schedule_type`, `customer_payment_method`.

When **`quote_id`** is sent and **`order_description`** is omitted, the server copies **`quote.quote_description`** into **`order_description`** if present.

**Quote conversion:** `POST /api/quote/.../convert` sets **`quote_id`** to the source quote and **`order_description`** from **`quote.quote_description`** (and keeps **`customer_description`** in sync with that text for older clients).

**Razorpay create:** `payment_mode_id === "2"` requires **`name`**, **`email`**, **`contact`** on the body for the payment link.

---

## 8. Get order by id — response shape

`GET /api/order/get/:id` returns **`record`** with:

- Flat order fields + populated **`user_info`**, **`city_info`**, **`category_info`**, **`partner_info`**, **`employee_info`**, **`franchise_info`**, **`address_info`**, **`service_info`**, **`quote_info`** (when `quote_id` is set)
- **`service_items`**: each element includes **`service_info`** and optional **`partner_info`**
- **`additional_charges`**: array from `order_additional_charge`
- **`order_payments`**: array from `order_payment`

---

## 9. Postman collection

Import **`postman/Help-PR-Orders-Module.postman_collection.json`** (repository path: `help-pr-backend-staging/postman/Help-PR-Orders-Module.postman_collection.json`).

Set collection variables:

| Variable | Usage |
|----------|--------|
| `baseUrl` | API host, e.g. `http://localhost:5001` |
| `accessToken` | JWT after login |
| `orderId` | Set after create (or paste manually) |
| `orderServiceId` | From `service_items[0]._id` or list APIs |
| `additionalChargeId` | After creating a charge |
| `orderPaymentId` | After creating a payment |

Replace placeholder ObjectIds in example bodies with real IDs from your environment.

---

## 10. Known limitations (for backlog)

- **`discount_percent`** / **`min_deposit`** are not applied inside **`computeOrderTotal`** yet.
- Existing DB rows may still have **numeric** `order_status` until a migration is run — see **`docs/ORDER_STATUS_MIGRATION.md`**.
- Razorpay webhook signature uses JSON body hashing; confirm against Razorpay’s latest raw-body guidance for production.
- Staff who are not `user_id` / `partner_id` / `created_by_id` / `employee_id` on the order cannot hit charge/payment APIs unless you add a role bypass.

---

## 11. Related code (for backend readers)

| Area | Path |
|------|------|
| Order model | `models/order.js` |
| Order service model | `models/order_services.js` |
| Additional charge model | `models/order_additional_charge.js` |
| Order payment model | `models/order_payment.js` |
| Totals helper | `utils/order_financials.js` |
| List/detail franchise access & participant check | `utils/order_access.js` (`resolveOrderListScope`, `assertOrderRecordAccess`, `callerMatchesOrderParticipant`) |
| Controllers | `controllers/order_controller.js`, `order_service_controller.js`, `order_additional_charge_controller.js`, `order_payment_controller.js`, `razorpay_controller.js` |
| Routes | `routes/order_routes.js`, `order_service_routes.js`, `order_additional_charge_routes.js`, `order_payment_routes.js`, `razorpay_routes.js` |
