# Calendar / appointments — frontend integration guide

Admin **Calendar** screen (`/calendar`) and **Schedule Appointment** modal. **Partner mobile app** calendar uses the same fields scoped to the partner’s orders.

Appointments are linked to orders: **one order → many appointments**. The first appointment is created **automatically** when an order is placed; staff and partners can add more manually.

Postman:
- Admin: **`postman/Help-PR-All-APIs.postman_collection.json`** → **44 — Appointment (calendar)**
- Partner mobile: same file → **Mobile → Partner → Appointments**

---

## 1. Base URL and access

### Admin web (`/api/appointment`)

| Item | Detail |
|------|--------|
| **Base path** | `{baseUrl}/api/appointment` |
| **Auth** | `Authorization: Bearer <backoffice_jwt>` |
| **Who can call** | Super admin (5), staff (6), franchise admin (1), employee (3) |
| **Blocked** | Partner (2), customer (4) → **403** |
| **Screen gate** | `{ page: "Calendar", url: "/calendar" }` in `accessible_screens` |

### Partner mobile (`/api/mobile/partner/appointments`)

| Item | Detail |
|------|--------|
| **Base path** | `{baseUrl}/api/mobile/partner/appointments` |
| **Auth** | `Authorization: Bearer <partner_jwt>` (`type` 2) |
| **Scope** | Only appointments for orders where `order.partner_id` = logged-in partner |
| **Create** | `order_id` must be an order assigned to the partner |

**Response envelope (admin):**

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

**Response envelope (partner mobile):** same top-level shape as other partner APIs (`success`, `status`, `message`, `records` or `record`, pagination on list).

---

## 2. API routes

### Admin — `/api/appointment`

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/getAll` | Calendar / list view |
| `GET` | `/getByOrder/:orderId` | All appointments for one order |
| `GET` | `/get/:id` | Single appointment |
| `POST` | `/create` | Manual schedule (modal Save) |
| `PUT` | `/update/:id` | Edit appointment |
| `DELETE` | `/delete/:id` | Soft delete |

### Partner mobile — `/api/mobile/partner/appointments`

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Partner calendar list (own orders only) |
| `GET` | `/order/:orderId` | Appointments for one assigned order |
| `GET` | `/:appointmentId` | Single appointment |
| `POST` | `/` | Create appointment on partner’s order |
| `PUT` | `/:appointmentId` | Update |
| `DELETE` | `/:appointmentId` | Soft delete |

`:id` / `:appointmentId` accept Mongo `_id` or `AP1001`. Partner `orderId` path param: Mongo `_id` only (same as **GET /orders/:orderId**).

---

## 3. Schedule Appointment modal → create

**Admin:** `POST /api/appointment/create`  
**Partner mobile:** `POST /api/mobile/partner/appointments`

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

1. **Order ID** — searchable dropdown from order list (`GET /api/order/getAll` admin, `GET /api/mobile/partner/orders` partner).
2. On order select — show **Partner** and **Service Name** as read-only from the order row (or `GET /api/order/get/:id`).
3. **Title**, **Service Date**, **Start / End Time** — editable; map to the body above.
4. **No Status field** in the modal — appointments are schedule entries only.

---

## 4. Calendar view → list

**Admin:** `GET /api/appointment/getAll?...`  
**Partner mobile:** `GET /api/mobile/partner/appointments?...`

```
GET /api/appointment/getAll?page=1&limit=50&from_date=2026-06-01&to_date=2026-06-30&franchise_id=&keyword=&order_id=

GET /api/mobile/partner/appointments?page=1&limit=50&from_date=2026-06-01&to_date=2026-06-30&order_id=
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

## 5. Order detail panel → appointments by order

**Admin:** `GET /api/appointment/getByOrder/O1001`  
**Partner mobile:** `GET /api/mobile/partner/appointments/order/:orderId`

```
GET /api/appointment/getByOrder/O1001
```

Returns `order_id`, `order_unique_id`, and `records[]` (newest `service_date` first). Use to show all appointments on an order, including the auto-created one.

---

## 6. Edit and delete

**Admin update:** `PUT /api/appointment/update/:id`  
**Partner update:** `PUT /api/mobile/partner/appointments/:appointmentId`  
**Admin delete:** `DELETE /api/appointment/delete/:id`  
**Partner delete:** `DELETE /api/mobile/partner/appointments/:appointmentId`

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
- [ ] Partner app: calendar uses `GET /api/mobile/partner/appointments` with date range.
- [ ] Partner app: create/update/delete only for orders from `GET /api/mobile/partner/orders`.
- [ ] After creating an order, refresh calendar or order appointments to show the auto-created row (`source: "auto"`).
