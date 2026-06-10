# Partner order work — frontend integration guide

This document describes how the **partner mobile app** starts work on an assigned order, completes it with proof photos, and **optionally** publishes the job to the **customer feed** (partner post).

Share with mobile (Flutter) developers together with:

- **`postman/Help-PR-Mobile-APIs.postman_collection.json`** — folder **Partner → Orders**
- **`docs/PARTNER_POST_FRONTEND.md`** — separate post APIs if the partner publishes to the feed **after** completion

---

## 1. Base URL and authentication

| Item | Detail |
|------|--------|
| **Partner order APIs** | `{baseUrl}/api/mobile/partner/orders/...` |
| **Auth** | `Authorization: Bearer <partner_token>` |
| **Caller** | Logged-in partner (`user.type === 2`), verified account |

Standard mobile success envelope:

```json
{
  "success": true,
  "status": 200,
  "message": "...",
  "record": { }
}
```

List endpoints also return `totalItems`, `todayCount`, `totalPages`, `currentPage`, `limit`, and `records[]` at the top level.

---

## 2. Two status fields (important)

Each order exposes **two independent status tracks**:

| Field | Who updates it (mobile) | Values | Meaning |
|-------|-------------------------|--------|---------|
| `order_status` | Partner on **Complete** (or admin on web) | `in-progress`, `completed`, `cancelled`, `refunded` | Platform order lifecycle |
| `partner_work_status` | Partner on **Start work** / **Complete** | `pending`, `in-progress`, `completed` | Partner job progress |

Typical lifecycle:

```text
Order created
  order_status         = in-progress
  partner_work_status  = pending

Partner taps "Start work"
  order_status         = in-progress   (unchanged)
  partner_work_status  = in-progress

Partner taps "Complete" (customer fully paid + proof photos)
  order_status         = completed
  partner_work_status  = completed
```

Partners **cannot** set `order_status` directly. They only move `partner_work_status` until completion, which also sets `order_status` to `completed`.

---

## 3. Recommended API call order

```text
1. GET  /api/mobile/partner/orders/:orderId
       → Load detail; drive UI from partner_work_status + user_payment_status

2. PUT  /api/mobile/partner/orders/:orderId/work-status
       → Partner starts job (pending → in-progress)

3. POST /api/mobile/partner/orders/:orderId/additional-charges   (optional)
       → Add transport / material / misc charges (same fields + pricing as admin web)

4. GET  /api/mobile/partner/orders/:orderId   (poll / refresh)
       → Wait until user_payment_status === "paid"

5. POST /api/mobile/partner/orders/:orderId/complete
       → Upload 1–4 proof images; optionally publish to customer feed
```

**Feed post is optional** at step 4 (`publish_as_post=false` by default). The partner can also create a post later via **`POST /api/mobile/partner/posts`** (see `PARTNER_POST_FRONTEND.md`).

---

## 4. UI state machine

Use these fields from order detail (`GET /orders/:orderId`):

| `partner_work_status` | `user_payment_status` | `order_status` | Show in partner app |
|----------------------|------------------------|----------------|---------------------|
| `pending` | any | `in-progress` | **Start work** button |
| `in-progress` | not `paid` | `in-progress` | “Waiting for customer payment” — disable **Complete** |
| `in-progress` | `paid` | `in-progress` | **Complete job** — photo picker + optional “Share to feed” toggle |
| `completed` | `paid` | `completed` | Done — show `work_proof_image_urls`, link to post if any |

Use **`partner_summary`** for all partner money UI (on **GET order detail**, **start work**, **complete**, and `order.partner_summary` after additional-charge CRUD). Do **not** show `total_price` as partner earnings.

```json
"partner_summary": {
  "service_earning": 24,
  "additional_charges_earning": 512,
  "total_earning": 536,
  "paid_amount": 1,
  "due_amount": 535,
  "payment_status": "partially_paid",
  "customer_order_total": 648.56,
  "customer_due_amount": 644.66,
  "customer_payment_status": "partially_paid"
}
```

| Block | Fields | Notes |
|-------|--------|-------|
| **Your earnings** | `total_earning`, `paid_amount`, `due_amount`, `payment_status` | Base service + extra charges only |
| **Service** | `service_earning` | Same as `service_items[0].partner_earning` |
| **Extra charges** | `additional_charges_earning` + `additional_charges[]` | Use each row’s **`amount`** (your charge), not `total_amount` (customer billed incl. tax & commission) |
| **Customer payment** | `customer_*` | For “waiting for payment” / **Complete** gate (`customer_payment_status === "paid"`) |

When adding charges (`POST .../additional-charges`), send **`amount`** — your portion. Server adds commission + tax for the customer bill.

Customer payments are recorded on the **user app** (`POST /api/mobile/user/orders/:orderId/payments`). The partner app only **reads** payment status.

---

## 5. Endpoints

### 5.1 List orders

```
GET /api/mobile/partner/orders?page=1&limit=10
```

**Query filters (optional):**

| Param | Values |
|-------|--------|
| `status` | `in-progress` \| `completed` \| `cancelled` \| `refunded` |
| `partner_work_status` | `pending` \| `in-progress` \| `completed` |
| `user_payment_status` | `unpaid` \| `partially_paid` \| `paid` \| … |
| `search`, `from_date`, `to_date`, `is_paid`, … | Same as before |

List rows include `partner_work_status`. Full proof images and completion notes are on **detail** only.

---

### 5.2 Order detail

```
GET /api/mobile/partner/orders/:orderId
```

**Path:** `orderId` = order Mongo `_id` (24-char hex).

**200 `record` includes (new fields):**

| Field | Type | Notes |
|-------|------|-------|
| `partner_work_status` | string | `pending` \| `in-progress` \| `completed` |
| `partner_work_status_info` | array | Timeline: `status`, `updated_at`, `updated_by_id`, `actor_role` |
| `work_proof_image_urls` | string[] | Proof photos after completion |
| `work_completion_description` | string | Optional notes from complete request |
| `work_completed_at` | ISO date | When partner completed |
| `partner_post_id` | string \| null | Linked feed post if created |
| `partner_summary` | object | Partner earnings rollup — use for money UI (see §4) |

Plus existing fields: `service_items[]`, `order_payments`, `additional_charges`, payment breakdown, etc.

---

### 5.3 Additional service charges (partner CRUD)

Partners can add, update, or remove extra charges on **their assigned orders** (same pricing rules and side effects as admin `/api/order-additional-charges`: commission + tax on each line; server recalculates `total_price`, `user_payment_status`, partner wallet caps, etc.).

```
GET    /api/mobile/partner/orders/:orderId/additional-charges
POST   /api/mobile/partner/orders/:orderId/additional-charges
PUT    /api/mobile/partner/orders/:orderId/additional-charges/:chargeId
DELETE /api/mobile/partner/orders/:orderId/additional-charges/:chargeId
```

**Create body (JSON):**

| Field | Required | Notes |
|-------|----------|-------|
| `amount` | Yes | Number ≥ 0 (partner portion, pre-commission/tax) |
| `label` | No | Short title, e.g. "Transport" |
| `description` | No | Longer note |
| `payment_method` | No | `cash` \| `upi` \| `card` \| `online` \| `bank_transfer` \| `other` (default `other`) |
| `charge_type` | No | e.g. `material`, `transport`, `labour`, `misc` (default `misc`) |

**Responses** include top-level **`partner_summary`** (same shape as order detail). Create/update also return **`record`** with `partner_amount` / `customer_billed_total` on each charge. List **GET** returns `records[]` + `partner_summary`. Mutations also include `order` pricing rollup (`total_price`, `user_payment_status`, `additional_charges_subtotal`, etc.).

**Invalid `payment_method`** values are stored as `other` (same as admin). **404** if the order is not assigned to the partner or the charge id does not belong to the order.

Charges are also visible on **GET order detail** (`additional_charges` array). Admin web routes (`/api/order/update`, `/api/order-additional-charges`) are unchanged.

---

### 5.4 Start work

```
PUT /api/mobile/partner/orders/:orderId/work-status
Content-Type: application/json
```

**Body:**

```json
{
  "partner_work_status": "in-progress"
}
```

**Rules:**

- Order must belong to logged-in partner (`partner_id`)
- `order_status` must be `in-progress`
- Current `partner_work_status` must be `pending`

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Partner work status updated successfully.",
  "record": { }
}
```

**Errors:**

| Status | When |
|--------|------|
| `400` | Invalid `orderId` or missing body |
| `404` | Order not found or not assigned to partner |
| `409` | Invalid transition (e.g. already `in-progress` or order already `completed`) |

---

### 5.5 Complete order (+ optional feed post)

```
POST /api/mobile/partner/orders/:orderId/complete
Content-Type: multipart/form-data
```

**Form fields:**

| Field | Required | Notes |
|-------|----------|-------|
| `images` | **Yes** | **1–4** JPEG/PNG files — proof of service |
| `publish_as_post` | No | `true` \| `false` — default **`false`** |
| `description` | If posting | Max 500 chars; **required when** `publish_as_post=true` |
| `post_description` | No | Alias for `description` |
| `work_completion_description` | No | Alias for `description` (stored on order) |

**Preconditions (server-enforced):**

1. `partner_work_status` = `in-progress` (call **Start work** first)
2. Customer fully paid: `user_payment_status` = `paid` (net paid ≥ `total_price`)
3. `order_status` = `in-progress`

**Example — complete only (no feed post):**

```
images:           [photo1.jpg, photo2.jpg]
publish_as_post:  false
description:      Kitchen deep clean done.   (optional)
```

**Example — complete + publish to customer feed:**

```
images:           [photo1.jpg, photo2.jpg]
publish_as_post:  true
description:      Before/after kitchen deep clean for order #ORD-123
```

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Order completed successfully.",
  "record": {
    "order_status": "completed",
    "partner_work_status": "completed",
    "work_proof_image_urls": ["https://..."],
    "work_completed_at": "...",
    "partner_post_id": "..."
  },
  "post": { },
  "post_error": null
}
```

- `post` — populated only when `publish_as_post=true` and post creation succeeded
- `post_error` — if order completed but feed post failed (order is still `completed`; show a warning and allow retry via **Posts** API)

**Errors:**

| Status | When |
|--------|------|
| `400` | Wrong image count; missing `description` when `publish_as_post=true` |
| `404` | Order not found |
| `409` | Customer not fully paid; work not started; order already completed/cancelled |

Example payment error (`409`):

```json
{
  "success": false,
  "status": 409,
  "message": "Cannot mark order as completed until the customer has paid the full order amount (paid 500, due 1500, total 2000)."
}
```

---

## 6. Optional feed post — two ways

### Option A — On complete (recommended UX)

Set `publish_as_post=true` on **`POST .../complete`**. Same proof images are reused for the feed post. One API call.

### Option B — After complete

1. Complete with `publish_as_post=false`
2. Later: **`POST /api/mobile/partner/posts`** with `post_type=order`, `order_id`, `description`, `images`

Or list eligible orders:

```
GET /api/mobile/partner/posts/order-options?page=1&limit=10
```

See **`docs/PARTNER_POST_FRONTEND.md`** for full post / feed / like / share APIs.

---

## 7. Flutter implementation notes

### Multipart complete request

Use `multipart/form-data`:

- Field name for files: **`images`** (repeat for each file, same as existing Posts API)
- Text fields: `publish_as_post`, `description`

### Polling payment status

After **Start work**, refresh order detail periodically or on push/deep-link until:

```dart
record['user_payment_status'] == 'paid'
```

Then enable the **Complete** button.

### Disable rules (summary)

```dart
bool canStartWork =>
  orderStatus == 'in-progress' && partnerWorkStatus == 'pending';

bool canComplete =>
  orderStatus == 'in-progress' &&
  partnerWorkStatus == 'in-progress' &&
  userPaymentStatus == 'paid';

bool showShareToFeedToggle => canComplete; // optional UI on complete screen
```

### After completion

- Navigate to order detail or completed list
- If `post != null`, optionally deep-link to post preview
- If `post_error != null`, show toast: order completed but feed post failed — offer “Post later” via Posts screen

---

## 8. Customer app (read-only context)

Customers do **not** call partner work APIs. They:

- Pay via **`POST /api/mobile/user/orders/:orderId/payments`**
- See order status on **`GET /api/mobile/user/orders/:orderId`**
- See feed posts on **`GET /api/mobile/user/posts`** (when partner published)

New order fields (`partner_work_status`, proof images) may appear on customer order detail after completion.

---

## 9. Admin web (unchanged for partners)

Back-office can still complete orders via **`PUT /api/order/update/:id`** with `order_status: "completed"` (same full-payment rule). That path also sets `partner_work_status` to `completed`. Partners do not use admin APIs.

---

## 10. Quick reference

| Step | Method | Path |
|------|--------|------|
| Load order | GET | `/api/mobile/partner/orders/:orderId` |
| List charges | GET | `/api/mobile/partner/orders/:orderId/additional-charges` |
| Add charge | POST | `/api/mobile/partner/orders/:orderId/additional-charges` |
| Update charge | PUT | `/api/mobile/partner/orders/:orderId/additional-charges/:chargeId` |
| Remove charge | DELETE | `/api/mobile/partner/orders/:orderId/additional-charges/:chargeId` |
| Start work | PUT | `/api/mobile/partner/orders/:orderId/work-status` |
| Complete + optional post | POST | `/api/mobile/partner/orders/:orderId/complete` |
| Post later (optional) | POST | `/api/mobile/partner/posts` |

**Postman:** `Help-PR-Mobile-APIs.postman_collection.json` → **Partner → Orders** → *Start work*, *Complete order*.

**Migration (backend ops):** Existing orders may need `node scripts/migrate-partner-work-status.js` before `partner_work_status` appears consistently in list/detail.
