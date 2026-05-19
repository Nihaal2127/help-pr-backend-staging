# Order status — string values (May 2026)

## Summary

Order and line-item status are now **string enums**, not numbers.

| Status | When |
|--------|------|
| `in-progress` | **Default on create** |
| `completed` | Job done |
| `cancelled` | Cancel order or line |
| `refunded` | Refund issued |

**Removed:** `Pending` (numeric `1`). New orders start as **`in-progress`**.

## API examples

**Create** — do not send `order_status`; server sets `in-progress`.

**Update order:**

```json
PUT /api/order/update/:id
{
  "order_status": "completed",
  "is_paid": true
}
```

**List filter:**

```http
GET /api/order/getAll?order_status=in-progress
```

## Database

- `order.order_status`: `String` enum
- `order.order_status_info[].status`: `String`
- `order_service.service_status`: `String` enum

## Legacy data

`normalizeOrderStatus()` maps old numeric values when filtering/updating:

| Old number | Maps to |
|------------|---------|
| 1 | `in-progress` |
| 2 | `in-progress` |
| 3 | `completed` |
| 4 | `cancelled` |

Run a one-time Mongo migration on existing orders if you have numeric `order_status` in production:

```javascript
// Example migration snippet (run in mongo shell / script)
db.orders.updateMany({ order_status: 1 }, { $set: { order_status: "in-progress" } });
db.orders.updateMany({ order_status: 2 }, { $set: { order_status: "in-progress" } });
db.orders.updateMany({ order_status: 3 }, { $set: { order_status: "completed" } });
db.orders.updateMany({ order_status: 4 }, { $set: { order_status: "cancelled" } });
// Repeat for order_services.service_status and order_status_info[].status
```

## Files touched

- `enum/order_status_enum.js`
- `models/order.js`, `models/order_services.js`
- `services/order_creation_service.js`
- `middleware/order_middleware.js`
- `controllers/order_controller.js`, `order_service_controller.js`
- `controllers/dashboard_controller.js`, `count_controller.js`, `export_controller.js`
- `postman/Help-PR-All-APIs.postman_collection.json` (Order folder; source: `postman/archive/Help-PR-Orders-Module.postman_collection.json`)
- `docs/ORDER_MODULE_FRONTEND.md`
