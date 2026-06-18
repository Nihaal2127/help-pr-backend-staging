# Chat — frontend integration guide

Realtime messaging for **order group chats**, **disputes** (completed orders), and **general support** (customer ↔ employee).

Postman: **`postman/Help-PR-All-APIs.postman_collection.json`** → **16 — Chat & Messages** (REST) plus new dispute/support routes below.

Socket.IO runs on the **same host/port** as the API when not deployed on AWS Lambda.

---

## 1. Chat types

| Type | `chat.type` | Participants | Created when |
|------|-------------|--------------|--------------|
| Order | `order` | Customer, partner, assigned employee, franchise admin | **Automatically** on order create |
| Dispute | `dispute` | Customer + order employee | Customer raises dispute on a **completed** order |
| General / support | `support` | Customer + employee | Customer or employee starts support chat |

---

## 2. Base URL and auth

| Client | REST base | Auth |
|--------|-----------|------|
| Admin / employee web | `{baseUrl}/api/chat` | `Authorization: Bearer <backoffice_jwt>` |
| Customer mobile | `{baseUrl}/api/mobile/user/...` | `Authorization: Bearer <customer_jwt>` (`type` 4) |
| All clients (messages) | `{baseUrl}/api/chat/messages` | Same JWT as above |
| Socket.IO | `{baseUrl}` (ws) | JWT in handshake `auth.token` or `Authorization` header |

**Response envelope (typical):**

```json
{
  "success": true,
  "status": 200,
  "message": "...",
  "record": {},
  "records": []
}
```

Chat list items now include **`unreadCount`** per chat.

---

## 3. REST routes

### Shared chat (`/api/chat`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Inbox (with `unreadCount`) |
| `GET` | `/:id` | Single chat |
| `GET` | `/by-order/:orderId` | Order group chat for an order |
| `POST` | `/support` | Start or resume support chat (customer or back-office) |
| `PATCH` | `/:id/status` | Close/reopen chat `{ "status": "closed" }` |
| `POST` | `/messages` | Send message (REST fallback) |
| `GET` | `/messages?chatId=…&after=…&limit=50` | Message history |

### Disputes — back-office (`/api/dispute`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/getAll` | Franchise-scoped dispute list |
| `GET` | `/get/:id` | Dispute detail (includes `chat_id`) |
| `PUT` | `/update/:id` | Update status `{ "status": "in_review" \| "resolved" \| "closed" }` |

### Customer mobile (`/api/mobile/user`)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/disputes` | Raise dispute on completed order |
| `GET` | `/disputes` | List own disputes |
| `GET` | `/disputes/:disputeId` | Dispute detail |
| `POST` | `/chats/support` | Start or resume general support chat |

### Order detail

Orders returned from order APIs include **`chat_id`** when an order chat exists. Use it to open the order group chat or call `GET /api/chat/by-order/:orderId`.

---

## 4. Auto-created order chat

When an order is created (`POST /api/order/create` or quote convert):

1. Backend creates a **group chat** (`type: "order"`, `isGroup: true`).
2. Participants: `order.user_id`, `order.partner_id`, `order.employee_id`, `franchise.admin_id`.
3. `order.chat_id` is set on the order document.
4. If partner/employee is assigned later, participants are **synced** on order update.

If some roles are missing at create time (e.g. no `employee_id` yet), the chat is still created with available participants and updated when the order changes.

---

## 5. Raise dispute (customer)

**POST** `/api/mobile/user/disputes`

```json
{
  "order_id": "<order_mongo_id>",
  "reason": "Service not completed properly",
  "description": "Optional longer text"
}
```

Rules:

- Order must belong to the logged-in customer.
- `order_status` must be **`completed`**.
- Order must have an **`employee_id`**.
- Only **one open dispute** per order (`409` if one already exists).

Response includes `record.chat_id` — open that chat for messaging.

---

## 6. General support chat

**Customer — POST** `/api/mobile/user/chats/support`

```json
{
  "employee_id": "OPTIONAL",
  "franchise_id": "OPTIONAL",
  "initial_message": "I need help"
}
```

If `employee_id` is omitted, backend picks the first available employee for the customer's franchise (or from their latest order).

**Back-office — POST** `/api/chat/support`

```json
{
  "customer_id": "<required for staff>",
  "employee_id": "<required when admin starts chat for another employee>",
  "initial_message": "Hi, how can I help?"
}
```

Returns existing **open** support chat for the same customer + employee pair when one exists.

---

## 7. Socket.IO

Connect with JWT, then:

| Emit | Payload | Listen |
|------|---------|--------|
| `join_chat` | `chatId` | — |
| `leave_chat` | `chatId` | — |
| `send_message` | `{ chatId, type, content, fileUrl?, metadata? }` | `receive_message` |
| `read_messages` | `{ chatId }` | — |
| `transfer_chat` | `{ chatId, newAssignedTo }` | `chat_assigned`, `chat_updated` |
| `add_member` / `remove_member` | group management | `member_added`, `member_removed`, `chat_updated` |

Errors arrive on **`chat_error`**.

**Message types:** `text`, `image`, `file`, `system`

---

## 8. UI mapping (suggested)

| Screen | API / socket |
|--------|----------------|
| Order detail → Chat tab | `order.chat_id` or `GET /api/chat/by-order/:orderId` → `join_chat` |
| Completed order → Raise dispute | `POST /api/mobile/user/disputes` → navigate to `chat_id` |
| Support / Help | `POST …/chats/support` or `/api/chat/support` |
| Chat inbox | `GET /api/chat` |
| Chat thread | `GET /api/chat/messages` + socket `send_message` / `receive_message` |
| Unread badge | `unreadCount` on each chat in list; mark read via socket `read_messages` |

---

## 9. Push notifications

New chat messages trigger FCM push to other participants (type `Chat`, data includes `chat_id`, `order_id` when applicable).

---

## 10. Notes

- Socket.IO is **not** available on AWS Lambda deploys; use REST `POST /api/chat/messages` as fallback.
- Dispute and support chats are **1:1** (customer + employee). Order chats are **group**.
- Closing a resolved dispute also closes the linked chat (`status: closed`).
