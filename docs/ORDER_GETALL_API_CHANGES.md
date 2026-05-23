# Orders `getAll` API — change summary

**Date:** May 2026  
**Scope:** `GET /api/order/getAll`, `GET /api/order/get/:id` (access), supporting code in `utils/order_access.js`  
**Postman:** `postman/Help-PR-All-APIs.postman_collection.json` → **Order** → **1. Get all orders**  
**Related:** Aligned with `GET /api/quote/getAll` behaviour (search, sort, franchise scope, date filters).

---

## 1. Overview

The admin order list endpoint was brought in line with the quote list: **role-based franchise scoping**, **validated filters**, **free-text search**, **sort** with collation, **date range / single-day filters**, and **hydrated list rows** for the UI.

Partners and customers **cannot** use `getAll`; they receive **403**. Customers should use **`GET /api/order/getCustomerOrder?user_id=...`**.

---

## 2. Role-based access

Implemented in `utils/order_access.js` (`resolveOrderListScope`, `assertOrderRecordAccess`).

| Caller type | `getAll` | `get/:id` |
|-------------|----------|-----------|
| Super admin (5) | All orders; optional `?franchise_id=` | Any order |
| Staff (6) | Same as super admin | Any order |
| Franchise admin (1) | Their franchise **plus** legacy orders (`franchise_id` null) whose partner, employee, or creator belongs to that franchise; wrong `franchise_id` query → **403** | Same franchise rules as list |
| Franchise employee (3) | Same as franchise admin | Same franchise rules as list |
| Partner (2) | **403** | **403** |
| Customer (4) | **403** | **403** |

`franchise_id` on the query string is **not** a free filter for everyone—it is validated against the caller’s franchise (same rules as quotes).

**Legacy orders:** Rows created without `franchise_id` still appear for franchise admin/employee when `partner_id`, `employee_id`, or `created_by_id` is a user on that franchise. New orders auto-set `franchise_id` from quote, partner, creator, or logged-in franchise user when omitted on create.

**Mutations (same JWT → DB user):** `POST /create`, `PUT /update`, `PUT /cancle`, `PUT /cancleService`, `PUT /serviceUpdate`, `DELETE /delete`, and nested charge/payment routes use `utils/order_access.js` — franchise admin/employee only for their franchise; super admin/staff unrestricted. `GET /getCustomerOrder` is unchanged (customer list by `user_id`).

---

## 3. `GET /api/order/getAll` — query parameters

| Parameter | Description |
|-----------|-------------|
| `page`, `limit` | Pagination (defaults `1`, `10`) |
| `order_status` | `in-progress`, `completed`, `cancelled`, `refunded`. Invalid → **409**. **`refunded`** also matches orders whose `user_payment_status` / `payment_status` is `refund` or `partially_refund` (same as getCount type 14). Other status filters exclude those refund rollups. |
| `is_paid` | `true` / `false` (legacy; true only when `payment_status === paid`) |
| `payment_status` | `unpaid`, `paid`, `partially_paid`, `refund`, `partially_refund`. Invalid → **409** |
| `search` | Sanitized free-text (preferred) |
| `keyword` | Legacy alias for `search` when `search` is empty |
| `from_date`, `to_date` | ISO date strings — see §4 |
| `franchise_id` | ObjectId; scoped by role (§2) |
| `user_id`, `partner_id`, `employee_id` | Optional ObjectId filters |
| `city_id`, `category_id`, `service_id` | Optional ObjectId filters |
| `sort_by` | Whitelist: `created_at`, `updated_at`, `order_date`, `order_status`, `total_price`, `sub_total`, `unique_id`, `is_paid`, `payment_status`, `tax`, `min_deposit`, `order_description` (invalid → `created_at`) |
| `sort_order` | `asc` or `desc` |
| `sort` | Legacy: `1` = ascending, anything else = descending if `sort_order` omitted |

Sort uses MongoDB collation `locale: en`, `strength: 2` (case-insensitive), same as quotes.

---

## 4. Date filters

**Fields used:** `from_date`, `to_date` on the order document, with **`order_date` fallback** when schedule fields are missing.

| Query | Behaviour |
|-------|-----------|
| **Only `from_date`** | Filter orders for **that calendar day** (UTC start → end of day) |
| **Only `to_date`** | Same — **that calendar day** |
| **Both** | Orders whose schedule **overlaps** the window `[from_date, to_date]` |

Matching uses `$or` across:

1. Both `from_date` and `to_date` set on the order and overlapping the window  
2. `from_date` set, `to_date` null/missing, `from_date` in window  
3. `to_date` set, `from_date` null/missing, `to_date` in window  
4. `order_date` within the window  

Invalid date strings → **409**. `to_date` before `from_date` (when both sent) → **409**.

**Examples:**

```http
GET /api/order/getAll?from_date=2026-05-14
GET /api/order/getAll?to_date=2026-05-14
GET /api/order/getAll?from_date=2026-05-10&to_date=2026-05-20
```

---

## 5. Search

When `search` (or legacy `keyword`) is set, results are filtered after joining related collections. Matches include (non-exhaustive):

- Order: `unique_id`, `user_unique_id`, `address`, `comments`, `order_description`, `customer_description`, `transaction_id`, `payment_mode_id`, `discount_code`
- Linked quote: `quote_sequence_id`, `quote_description`
- Users: customer, partner, employee, created_by — name, `user_id`, email, phone
- Category, service, city, franchise names/codes

Input is passed through `sanitizeInput` (same validator as quotes).

---

## 6. List response shape

Success **200**:

```json
{
  "success": true,
  "status": 200,
  "message": "Order list fetched successfully.",
  "totalItems": 42,
  "totalPages": 5,
  "currentPage": 1,
  "records": [ /* ... */ ]
}
```

Each record in `records` includes display helpers and hydrated refs (same pattern as quote list):

- **Names:** `user_name`, `partner_name`, `employee_name`, `category_name`, `service_name`, `city_name`, `user_unique_id`, `partner_unique_id`
- **Nested objects:** `user_id`, `partner_id`, `employee_id`, `created_by_id`, `category_id`, `service_id`, `franchise_id`, `city_id`, `address_id` (with city/state on address when present), `quote_id` (sequence id + description)
- **`service_items`:** populated `order_service` line objects (not raw ObjectId buffers). Each item includes `_id`, `service_status`, `service_date`, pricing fields, etc. Use `GET /api/order/get/:id` for full line detail with partner/service embeds.

---

## 7. `GET /api/order/get/:id`

- **`assertOrderRecordAccess`** applied (franchise rules in §2).
- Soft-deleted orders (`deleted_at` set) return **404**.

---

## 8. Files changed

| File | Change |
|------|--------|
| `utils/order_access.js` | `resolveOrderListScope`, `assertOrderRecordAccess` (plus existing `callerMatchesOrderParticipant`) |
| `controllers/order_controller.js` | `getAll` pipeline; date helpers; `getById` access check |
| `postman/archive/Help-PR-Orders-Module.postman_collection.json` | Source for merge; use `postman/Help-PR-All-APIs.postman_collection.json` in Postman |
| `docs/ORDER_GETALL_API_CHANGES.md` | This document |

---

## 9. Frontend checklist

1. Use **staff / franchise admin / employee** tokens for order management lists—not partner/customer tokens on `getAll`.
2. Pass **`search`**, **`sort_by`**, **`sort_order`** like the quote list screen.
3. For date pickers: one date → send only `from_date` **or** only `to_date`; range → send both.
4. Do not rely on raw `franchise_id` from the client for franchise users—the server enforces scope from JWT.
5. For customer “my orders”, keep using **`GET /api/order/getCustomerOrder`**.

---

## 10. Error responses (common)

| Status | When |
|--------|------|
| **401** | Invalid / missing JWT |
| **403** | Wrong role or franchise for list/detail |
| **409** | Invalid `order_status`, invalid dates, or `to_date` before `from_date` |
| **500** | Server error |
