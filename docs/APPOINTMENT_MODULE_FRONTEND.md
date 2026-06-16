# Calendar / appointments — frontend integration guide

Admin **Calendar** screen (`/calendar`) and **Schedule Appointment** modal. Appointments are linked to orders: **one order → many appointments**. The first appointment is created **automatically** when an order is placed; staff can add more manually.

Postman: **`postman/Help-PR-All-APIs.postman_collection.json`** → folder **44 — Appointment (calendar)**.

---

## 1. Base URL and access

| Item | Detail |
|------|--------|
| **Base path** | `{baseUrl}/api/appointment` |
| **Auth** | `Authorization: Bearer <backoffice_jwt>` |
| **Who can call** | Super admin (5), staff (6), franchise admin (1), employee (3) |
| **Blocked** | Partner (2), customer (4) → **403** |
| **Screen gate** | User should have `accessible_screens` entry `{ page: "Calendar", url: "/calendar" }` |

**Response envelope:**

```json
{
  "success": true,
  "status": 200,
  "message": "...",
  "record": { },
  "records": [],
  "totalItems": 0,
  "totalPages": 0,
  "currentPage": 1
}
```

List endpoints return `records[]` + pagination. Single-resource endpoints return `record`.

---

## 2. API routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/getAll` | Calendar / list view |
| `GET` | `/getByOrder/:orderId` | All appointments for one order |
| `GET` | `/get/:id` | Single appointment |
| `POST` | `/create` | Manual schedule (modal Save) |
| `PUT` | `/update/:id` | Edit appointment |
| `DELETE` | `/delete/:id` | Soft delete |

`:id` and `:orderId` accept **Mongo `_id`** or **business id** (`AP1001`, `O1001`).

---

## 3. Schedule Appointment modal → `POST /create`

**Required body**

| Field | Type | Notes |
|-------|------|-------|
| `order_id` | string | Mongo `_id` or `unique_id` (e.g. `O1001`) |
| `service_date` | string | `YYYY-MM-DD` |

**Optional**

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | Max 200 chars; server default if omitted |
| `start_time` | string | `HH:mm` (e.g. `09:00`) |
| `end_time` | string | `HH:mm`; must be after `start_time` if both sent |
| `status` | string | **Optional — omit from UI.** If sent: `scheduled`, `in-progress`, `completed`, `cancelled`. Defaults to `null` when omitted. |

**Do not send from the client** — filled by the server from the order:

- `partner_name`
- `service_name`

**Example (no status — recommended)**

```json
{
  "title": "Follow-up visit",
  "order_id": "O1001",
  "service_date": "2026-06-17",
  "start_time": "09:00",
  "end_time": "11:00"
}
```

**UI wiring**

1. **Order ID** — searchable dropdown from existing order list APIs (`GET /api/order/getAll` or your order dropdown).
2. On order select — show **Partner** and **Service Name** as read-only from the order row (or `GET /api/order/get/:id`).
3. **Title**, **Service Date**, **Start / End Time** — editable; map to the body above.
4. **No Status field** in the modal — appointments are schedule entries only.

---

## 4. Calendar view → `GET /getAll`

```
GET /api/appointment/getAll?page=1&limit=50&from_date=2026-06-01&to_date=2026-06-30&franchise_id=&keyword=&order_id=
```

| Query | Notes |
|-------|--------|
| `from_date` / `to_date` | UTC calendar-day filter on `service_date`. One date alone = that day. |
| `franchise_id` | Super/staff: optional. Franchise admin/employee: auto-scoped to their franchise. |
| `order_id` | Optional; server checks order access. |
| `status` | Optional legacy filter — omit in new UI |
| `keyword` | Title, order id, partner name, service name, appointment id |
| `page` / `limit` | Default limit **50** |

**Each `records[]` item (API-shaped for UI):**

| Field | Format |
|-------|--------|
| `unique_id` | `AP1001` |
| `title` | string |
| `order_id` / `order_unique_id` | string |
| `partner_name` / `service_name` | string (display only) |
| `service_date` | `YYYY-MM-DD` |
| `start_time` / `end_time` | `HH:mm` or `null` |
| `source` | `auto` (from order create) or `manual` |
| `status` | `null` or string — **ignore in UI** unless you add status later |

Render calendar events using `service_date` + `start_time` / `end_time`. If times are null, show as all-day or “time TBD”.

---

## 5. Order detail panel → `GET /getByOrder/:orderId`

```
GET /api/appointment/getByOrder/O1001
```

Returns `order_id`, `order_unique_id`, and `records[]` (newest `service_date` first). Use to show all appointments on an order, including the auto-created one.

---

## 6. Edit and delete

**Update** — `PUT /api/appointment/update/:id`

```json
{
  "title": "Rescheduled visit",
  "service_date": "2026-06-18",
  "start_time": "10:00",
  "end_time": "12:00"
}
```

At least one field required. Partner/service name cannot be changed. Omit `status`.

**Delete** — `DELETE /api/appointment/delete/:id` (soft delete; row disappears from lists).

---

## 7. Auto-create on order (no extra frontend call)

When back-office or quote conversion calls **`POST /api/order/create`** (or quote → order), the backend creates **one** appointment with `source: "auto"`. No calendar API call is needed on order success.

If the order has no schedule times yet, the auto appointment may have `start_time` / `end_time` as `null` — allow edit via the modal or calendar.

---

## 8. Error handling

| Status | Typical cause |
|--------|----------------|
| **401** | Missing / invalid JWT |
| **403** | Partner, customer, or wrong franchise |
| **404** | Order or appointment not found |
| **400** | Invalid date/time, missing `service_date`, `end_time` before `start_time` |

---

## 9. Suggested frontend checklist

- [ ] Calendar page loads `GET /getAll` with visible date range (`from_date` / `to_date`).
- [ ] “Schedule Appointment” opens modal; Order ID dropdown searches orders.
- [ ] Partner + Service Name read-only after order pick.
- [ ] Modal fields: Title, Service Date, Start Time, End Time only (**no Status**).
- [ ] Save calls `POST /create`; edit calls `PUT /update/:id`.
- [ ] Order detail shows `GET /getByOrder/:orderId`.
- [ ] Hide calendar + Save for non–back-office roles (API returns 403 anyway).
- [ ] After creating an order, refresh calendar or order appointments to show the auto-created row (`source: "auto"`).
