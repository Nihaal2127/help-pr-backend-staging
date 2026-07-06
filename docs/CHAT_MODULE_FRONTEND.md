# Chat — frontend integration guide

Realtime messaging for **order group chats**, **disputes** (completed orders), and **general support** (customer ↔ handler).

Applies to **admin/employee web**, **Flutter customer mobile**, and any client using the same JWT + Socket.IO protocol.

Postman: **`postman/Help-PR-All-APIs.postman_collection.json`** → **39 — Chat** (REST), **45 — Dispute**, and **Mobile → User → Chat & Disputes**.

---

## 1. Chat types

| Type | `chat.type` | Participants | Created when |
|------|-------------|--------------|--------------|
| Order | `order` | Customer, partner, assigned employee, franchise admin | **Automatically** on order create |
| Dispute | `dispute` | Customer + **handler** (employee or franchise admin when assigned) — always **1:1** | Customer raises dispute on an **eligible completed** order — see [§7](#7-dispute-chats) |
| General / support | `support` | Customer + **handler** (employee or franchise admin when assigned) — always **1:1** | Customer or back-office starts support chat — see [§8](#8-general-support-chat) |

**Support and dispute** threads are strictly **one customer + one handler**. Franchise admin, super admin, and staff are **not** added as participants unless they become the handler (via transfer). They may still **read** threads in scope — see [Read vs write by role](#read-vs-write-by-role).

---

## 2. Base URL and auth

**Two backends:** business APIs (orders, disputes, auth) stay on **Lambda / API Gateway**. All chat REST + Socket.IO run on the **Chat Service** (VPS).

| Client | REST base | Auth |
|--------|-----------|------|
| Admin / employee web (chat) | `{chatServiceUrl}/api/chat` | `Authorization: Bearer <backoffice_jwt>` |
| Customer mobile (chat) | `{chatServiceUrl}/api/mobile/user/...` | `Authorization: Bearer <customer_jwt>` (`type` 4) |
| All clients (messages) | `{chatServiceUrl}/api/chat/messages` | Same JWT as above |
| Socket.IO | `{chatServiceUrl}` (ws) | JWT in handshake `auth.token` or `Authorization` header |
| Orders, disputes, auth | `{lambdaApiUrl}/api/...` | Same JWT |
| **File uploads (chat attachments)** | `{lambdaApiUrl}/api/document_upload/files` | Same JWT — see [§4 Attachments](#attachments-images--documents) |

`{chatServiceUrl}` example: `http://13.201.79.72` (production VPS). Socket.IO uses the same host/port as chat REST.

**JWT:** Same `JWT_SECRET` as Lambda — tokens issued by either backend work on the Chat Service.

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

### Inbox scope by role (`GET /api/chat`)

| Role | What appears in inbox |
|------|------------------------|
| **Customer** | Chats where they are a participant |
| **Employee** | Support/dispute/order chats they are **assigned to** or a **participant** in |
| **Franchise admin** | Above **plus** all franchise chats (orders, disputes, support for that franchise) |
| **Staff** (`type: 6`) | **All chats** platform-wide (paginated, default `limit=50`) — **read-only** |
| **Super admin** (`type: 5`) | **All chats** platform-wide (paginated, default `limit=50`) — **read-only** |

Super admin and staff are not auto-added as participants; the inbox uses platform-wide listing. Franchise admin sees franchise-wide threads even when not the handler (read-only until assigned — see below).

Optional query params: `type`, `status`, `page`, `limit` (max 200).

### Read vs write by role

Rules differ by `chat.type`. On **support** and **dispute** (1:1 handoff threads):

| Role | Read thread / history | Send messages | Transfer / close |
|------|----------------------|---------------|------------------|
| **Customer** | Yes (participant) | Yes | No |
| **Assigned handler** (`assignedTo` = caller) | Yes | Yes | Yes |
| **Franchise admin** (not `assignedTo`) | Yes (franchise scope) | **No** | Yes (franchise scope) |
| **Previous handler** (after transfer) | Yes (franchise scope) | **No** | No |
| **Other franchise employee** (not handler) | Yes (franchise scope) | **No** | No |
| **Super admin / staff** | Yes (platform-wide) | **No** | No |

**UI rule for support/dispute compose:** show the message input only when `chat.assignedTo === currentUserId` (or caller is the customer on mobile). Hide typing, attach, transfer, and close for read-only roles as appropriate.

Server enforces write access with `403` `CHAT_READ_ONLY` when a read-only user calls `send_message`, `POST /messages`, `typing_start` / `typing_stop`, or edit/delete.

**Order** group chats keep the previous model: participants and franchise-scoped roles can read/write per [§9](#9-transfer-chat-reassign-handler) manage rules.

---

Chat and message APIs include **display fields** so clients can show who is in the thread without extra user lookups.

**On every chat `record` / inbox item** (also on `chat_updated`, `chat_assigned`, support create):

| Field | Purpose |
|-------|---------|
| `assignedTo` | Handler user id (unchanged) |
| `assignedToUser` | `{ _id, name, type, profile_url, role }` — use for **support/dispute header** (handler name; may be employee or franchise admin) |
| `participants` | Participant ids (unchanged) |
| `participantUsers` | Array of `{ _id, name, type, profile_url, role }` for everyone in the thread |
| `roles` | `{ userId, role }` entries (unchanged) |

**Support chat (customer mobile):** show `assignedToUser.name` (and `profile_url`) as “Chatting with …”.

**On every message** (`GET /messages`, `message_sent`, `receive_message`, `message_edited`):

| Field | Purpose |
|-------|---------|
| `senderId` | Sender user id (unchanged) |
| `senderUser` | `{ _id, name, type, profile_url, role }` — use for **message bubble label/avatar** |
| System messages | `senderUser.role` = `"system"`, `senderUser.name` = `"System"` |

No email or phone is exposed in these objects.

---

## 3. Transport model — Socket.IO first

**Realtime chat runs on Socket.IO.** REST is not the main messaging path and must **not** be polled for new messages.

| Concern | Primary (use this) | REST (when to use) |
|---------|-------------------|-------------------|
| Send message | Socket `send_message` | `POST /messages` **only if socket is disconnected** |
| Receive new messages | Listen `receive_message` | **Never poll** `GET /messages` on an interval |
| Typing, delivery, read receipts | Socket events (see §4) | REST equivalents only as socket fallback |
| Presence | Listen `presence_updated` | `GET /presence/...` for initial load or after reconnect |
| Edit / delete | Socket `edit_message` / `delete_message` | `PATCH` / `DELETE /messages/:id` as fallback |
| Transfer / members | Socket or REST (either is fine) | Same behaviour either way |

### Recommended client flow

1. **Connect** Socket.IO to `{chatServiceUrl}` with JWT (keep one connection per app session).
2. **Bootstrap with REST (once):** `GET /api/chat` for inbox, `GET /messages?chatId=…` for initial history when opening a thread.
3. **Join room:** emit `join_chat` with `chatId`.
4. **Live thread:** send via `send_message` with a `clientMessageId`; confirm on **`message_sent`** (your message) or **`receive_message`** (others).
5. **Scroll up:** `GET /messages?before=…` once per page — not a polling loop.
6. **On disconnect:** show offline UI; optionally retry socket with backoff. Use `POST /messages` only if the user sends while socket is still down.
7. **On reconnect:** `join_chat` again; optionally `GET /messages?after=<lastMessageCreatedAt>` to catch anything missed during the gap.

```text
[App open] → connect socket → GET inbox (REST, once)
[Open thread] → GET messages (REST, once) → join_chat (socket)
[User sends] → send_message + clientMessageId → message_sent (self) / receive_message (others)
[Send failed] → chat_error with clientMessageId → show retry
[Socket down] → POST /messages with clientMessageId until socket recovers
```

---

## 4. Socket.IO (primary messaging)

Connect to `{chatServiceUrl}` with JWT (`auth.token` or `Authorization` header).

| Emit | Payload | Listen |
|------|---------|--------|
| — | (on connect) | `connection_status` `{ status: "connected" }` |
| `join_chat` | `chatId` | — |
| `leave_chat` | `chatId` | — |
| `send_message` | `{ chatId, type, content, fileUrl?, clientMessageId?, metadata? }` | **`message_sent`** (sender only), `receive_message` (other participants) |
| `message_delivered` | `{ messageId }` | `message_delivered` |
| `read_messages` | `{ chatId }` | `messages_read` |
| `typing_start` / `typing_stop` | `{ chatId }` | `typing_start` / `typing_stop` |
| `edit_message` | `{ messageId, content }` | `message_edited` |
| `delete_message` | `{ messageId }` | `message_deleted` |
| `transfer_chat` | `{ chatId, newAssignedTo }` | `chat_assigned`, `chat_updated`, `receive_message` (system) |
| `add_member` / `remove_member` | group management | `member_added`, `member_removed`, `chat_updated` |
| — | — | `presence_updated` `{ userId, isOnline, lastSeenAt? }` |

Errors arrive on **`chat_error`** (may include `clientMessageId` and `chatId` when a send failed).

### `clientMessageId` — correlate optimistic UI

Generate a local UUID per outbound message (e.g. `tmp-a1b2c3`). Pass it when sending:

**Socket emit:**

```json
{
  "chatId": "…",
  "type": "text",
  "content": "Hello",
  "clientMessageId": "tmp-a1b2c3"
}
```

**REST fallback:**

```json
{
  "chatId": "…",
  "type": "text",
  "content": "Hello",
  "clientMessageId": "tmp-a1b2c3"
}
```

The server stores it on `record.metadata.clientMessageId` and echoes it on ack/error responses.

| Event / response | When | Payload |
|------------------|------|---------|
| `message_sent` | Your socket send succeeded | `{ clientMessageId, chatId, record }` |
| `receive_message` | Someone else sent (or REST broadcast) | Full message; check `metadata.clientMessageId` to dedupe |
| `chat_error` | Socket send failed | `{ message, code, status, clientMessageId?, chatId? }` |
| `POST /messages` `201` | REST send succeeded | `{ clientMessageId, record }` |
| `POST /messages` `4xx/5xx` | REST send failed | `{ clientMessageId?, code, message }` |

**Sender vs receiver:** On socket send success, **only you** receive `message_sent`. Other participants receive `receive_message`. Do not wait for `receive_message` to confirm your own send.

### Failed send handling (client)

The server does **not** retry or queue failed sends. The client owns optimistic UI and retry.

1. **Show immediately** — add bubble with `status: "sending"` and your `clientMessageId`.
2. **Send** — `send_message` (or `POST /messages` if socket is down).
3. **Success** — on `message_sent` or REST `201`, match `clientMessageId`, replace temp bubble with `record._id`, set `status: "sent"`.
4. **Failure** — on `chat_error` (matching `clientMessageId`) or REST `success: false`, set `status: "failed"`, show **Retry**.
5. **Retry** — reuse the same `clientMessageId` only if you are sure the first attempt did not persist; otherwise generate a new one to avoid duplicates.
6. **Ambiguous disconnect** — if the socket drops mid-send, on reconnect run `GET /messages?after=<lastKnownCreatedAt>` and match `metadata.clientMessageId` before retrying.

```text
Tap Send → bubble (sending, clientMessageId: tmp-1)
  → message_sent (tmp-1) → bubble (sent, _id: 64f…)
  → chat_error (tmp-2)   → bubble (failed) → Retry
```

**Message types:** `text`, `image`, `file`, `system`

### Attachments (images & documents)

The chat service stores a **URL reference** only — it does **not** accept multipart file uploads. Upload on **Lambda**, then send the returned URL in the chat message.

**Step 1 — Upload file (Lambda)**

`POST {lambdaApiUrl}/api/document_upload/files`

| Part | Value |
|------|--------|
| `files` | One or more files (multipart field name **`files`**, max **5** per request) |
| `type` | **`7`** for all chat attachments (images and PDFs) |

**Auth:** `Authorization: Bearer <jwt>` (same user sending the chat message).

**Allowed file types:** JPEG, JPG, PNG, WebP, PDF  
**Max size:** 10 MB per file

**Response `200`:**

```json
{
  "success": true,
  "status": 200,
  "message": "File uploaded successfully",
  "records": [
    "https://cdn.example.com/chat_attachment/abc123_invoice.pdf"
  ]
}
```

Use **`records[0]` exactly** as `fileUrl` in the chat message. Do **not** rebuild the URL from `type`, user role, or filename.

**Upload `type` values** (`body.type`):

| `type` | Folder | Public URL in response? |
|--------|--------|-------------------------|
| `1` | `partner_document` | No — private |
| `2` | `category` | Yes |
| `3` | `service` | Yes |
| `4` | `user_profile` | Yes |
| `5` | `partner_post` | Yes |
| `6` | `order_work_proof` | Yes |
| **`7`** | **`chat_attachment`** | **Yes — required for all chat images & documents** |

**Chat uploads must use `type: 7`.** Files are stored under `chat_attachment/<uuid>_<filename>` in S3 and returned as `https://<cdn>/chat_attachment/...`.

Do not use `type: 2` (category) or other folders for chat — that mixes chat files with catalog assets and makes CDN path bugs harder to spot.

Invalid or missing `type` returns `400` from the upload API.

**Step 2 — Send chat message (Chat Service)**

Pick `type` from the file:

| File | Message `type` |
|------|----------------|
| JPEG / PNG / WebP | `image` |
| PDF (or other document) | `file` |

**Socket (preferred):**

```json
{
  "chatId": "674a1b2c3d4e5f6789012345",
  "type": "image",
  "fileUrl": "https://cdn.example.com/chat_attachment/abc123_photo.jpg",
  "content": "Optional caption",
  "clientMessageId": "tmp-upload-1",
  "metadata": {
    "fileName": "photo.jpg",
    "mimeType": "image/jpeg",
    "sizeBytes": 245760
  }
}
```

**REST fallback** — `POST {chatServiceUrl}/api/chat/messages`:

```json
{
  "chatId": "674a1b2c3d4e5f6789012345",
  "type": "file",
  "fileUrl": "https://cdn.example.com/chat_attachment/abc123_invoice.pdf",
  "content": "Please review this invoice",
  "clientMessageId": "tmp-upload-2",
  "metadata": {
    "fileName": "invoice.pdf",
    "mimeType": "application/pdf"
  }
}
```

`metadata` is optional but recommended for document bubbles (`fileName`, `mimeType`, `sizeBytes`). The server does not validate MIME type on send — the client should set `type` and `metadata` from the uploaded file.

**Step 3 — Receive & display**

Incoming messages (`receive_message`, `message_sent`, `GET /messages`) include:

| Field | Use in UI |
|-------|-----------|
| `type` | `image` → inline preview; `file` → download / open link |
| `fileUrl` | Load image or open document |
| `content` | Caption under the attachment |
| `metadata.fileName` | Document title when `type` is `file` |
| `metadata.mimeType` | Icon or “PDF” label |

Push notifications show **“Sent an image”** or **“Sent a file”** when the recipient is offline.

**Client upload progress:** Track locally while calling `document_upload`; the chat service does not report upload percent. Show bubble `status: "sending"` only after upload succeeds and the chat `send_message` / `POST /messages` call starts.

**Edit / delete:** `edit_message` and `PATCH /messages/:id` only change **text** (`content`), not the attachment. `delete_message` soft-deletes and clears `fileUrl` on the server.

**Common mistakes**

| Mistake | Result |
|---------|--------|
| Rebuilding URL as `${cdn}/${uploadType}${userType}/${fileName}` | Wrong path (e.g. `24/...`) → CloudFront `AccessDenied` |
| Using `type: 2` (category) for chat | Files mixed with catalog images; wrong folder in S3 |
| Using `{chatServiceUrl}` as CDN base | 404 — chat VPS does not host uploaded files |
| Skipping upload and sending a local/blob URL | Other participants cannot open the file |

**Ops:** New uploads use the S3 prefix `chat_attachment/`. CloudFront must serve that prefix the same way as `category/` and `partner_post/` (OAC/bucket policy). Existing files under other folders are not moved automatically.

**Message fields (delivery / read receipts):**

| Field | Values / shape |
|-------|----------------|
| `deliveryStatus` | `sent` → `delivered` → `read` |
| `deliveredTo` | `[{ userId, deliveredAt }]` |
| `readBy` | `[{ userId, readAt }]` |
| `editedAt` | ISO date when edited, else `null` |
| `deletedAt` | ISO date when soft-deleted (hidden from history) |
| `senderUser` | `{ _id, name, type, profile_url, role }` — display name/avatar for the bubble |

**History pagination (REST, not polling):** `GET /messages?before=…` when the user scrolls up; `GET /messages?after=…` once after reconnect to fill gaps. Do not send both `before` and `after` in one request.

**Date separators:** Render client-side from each message's `createdAt`.

---

## 5. REST routes

Use REST for **setup, inbox, history bootstrap, and socket fallback** — not for live message streaming.

### Shared chat (`/api/chat`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Inbox (with `unreadCount`) — load on screen open / pull-to-refresh. Query: `?type=support\|order\|dispute`, `?status=open`, `?page=1`, `?limit=50` |
| `GET` | `/:id` | Single chat metadata |
| `GET` | `/by-order/:orderId` | Resolve order group chat |
| `POST` | `/support` | Start or resume support chat |
| `PATCH` | `/:id/status` | Close/reopen chat `{ "status": "closed" \| "open" }` — see [§13](#13-closing-chats) |
| `POST` | `/:id/transfer` | Reassign handler `{ "newAssignedTo": "<employee_id>" }` |
| `POST` | `/messages` | **Fallback only** — send when socket unavailable; include `clientMessageId` |
| `GET` | `/messages?chatId=…&after=…&limit=50` | Initial load or post-reconnect gap fill — **not polling** |
| `GET` | `/messages?chatId=…&before=…&limit=50` | Scroll-up history — one request per page |
| `PATCH` | `/messages/:messageId` | **Fallback** edit own message |
| `DELETE` | `/messages/:messageId` | **Fallback** soft-delete own message |
| `POST` | `/messages/:messageId/delivered` | **Fallback** mark delivered |
| `GET` | `/presence/:userId` | Initial presence snapshot |
| `GET` | `/:id/presence` | Presence for all chat participants |

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

## 6. Auto-created order chat

When an order is created (`POST /api/order/create` or quote convert):

1. Backend creates a **group chat** (`type: "order"`, `isGroup: true`).
2. Participants: `order.user_id`, `order.partner_id`, `order.employee_id`, `franchise.admin_id`.
3. `order.chat_id` is set on the order document.
4. If partner/employee is assigned later, participants are **synced** on order update.

If some roles are missing at create time (e.g. no `employee_id` yet), the chat is still created with available participants and updated when the order changes.

---

## 7. Dispute chats

Dispute chats are **not** started like support chats. Only the **customer** can create a dispute (which auto-provisions the chat). Admin and employee web clients **open an existing** dispute thread — they cannot initiate a new dispute chat.

### Overview

| Property | Value |
|----------|--------|
| `chat.type` | `"dispute"` |
| `isGroup` | `false` (1:1) |
| **Participants** | Customer + handler (`assignedTo` — initially order’s `employee_id`; may become franchise admin after transfer) |
| **`assignedTo`** | Current handler (employee or franchise admin) |
| **`context`** | `{ orderId, disputeId }` |
| **Separate from order chat** | Dispute has its **own** `chat_id` — do not reuse `order.chat_id` |

| Who | Can initiate dispute chat? |
|-----|----------------------------|
| **Customer** (mobile) | **Yes** — `POST /api/mobile/user/disputes` |
| **Admin / employee** (web) | **No** — open `chat_id` from dispute record |
| **Any client** | **No** `POST /api/chat` for disputes — chat is auto-provisioned server-side |

### Order eligibility (which orders can get a dispute chat)

Only the **logged-in customer** can raise a dispute, and only via **`POST /api/mobile/user/disputes`**. There is no web or admin API to start a dispute.

An order is **eligible** when **all** of the following are true:

| # | Rule | Why |
|---|------|-----|
| 1 | Order **`user_id`** matches the logged-in customer | Disputes are customer-initiated on their own orders |
| 2 | Order **`order_status`** is **`completed`** | Disputes are post-service only |
| 3 | Order has **`employee_id`** set | Dispute chat is 1:1 customer ↔ assigned employee |
| 4 | Order is **not** soft-deleted (`deleted_at: null`) | Deleted orders are ignored |
| 5 | No **open** dispute already exists for that order | “Open” = status `open` or `in_review` |

**Not checked by the API today** (do not rely on these for eligibility unless product adds them later):

- Payment status, refund state, or partner assignment
- Whether the order group chat (`order.chat_id`) exists
- Franchise or service category

#### Eligible vs ineligible (examples)

| Order state | Can raise dispute? |
|-------------|------------------|
| `completed` + has `employee_id` + customer’s order + no open dispute | **Yes** |
| `pending`, `in_progress`, `cancelled`, or any non-`completed` status | **No** — `409` “Disputes can only be raised for completed orders.” |
| `completed` but **`employee_id` is null** | **No** — `409` “This order has no assigned employee for dispute chat.” |
| Another customer’s order | **No** — `404` “Order not found.” |
| Already has dispute `open` or `in_review` | **No** — `409` “An open dispute already exists…” — use `record.chat_id` from response |
| Previous dispute **`resolved`** or **`closed`** on same order | **Yes** — a **new** dispute may be raised (new dispute record + new chat) |

Show **“Raise dispute”** on mobile only when the order passes rules 1–5. Hide or disable for in-progress/cancelled orders and when an open dispute already exists (deep-link to existing `chat_id` instead).

#### API errors (eligibility)

| HTTP | Message | Meaning |
|------|---------|---------|
| `400` | Valid `order_id` required | Invalid or missing `order_id` |
| `404` | Order not found | Wrong id or not this customer’s order |
| `409` | Disputes can only be raised for completed orders | `order_status !== completed` |
| `409` | This order has no assigned employee… | Missing `employee_id` |
| `409` | An open dispute already exists… | Use existing `record.chat_id` |
| `500` | Failed to create dispute chat | Dispute rolled back — retry later |

#### Who the dispute chat connects

When eligible and raised successfully:

- **Customer** = `order.user_id`
- **Handler** = `order.employee_id` at time of raise (may change via [transfer](#9-transfer-chat-reassign-handler))
- **Franchise** = `order.franchise_id` (used for admin inbox scoping, not a separate participant)

Franchise admin, super admin, and staff can **read** the dispute thread in scope but only the **assigned handler** and the **customer** may send messages until a transfer changes `assignedTo`.

The dispute chat is **separate** from the order **group** chat (`order.chat_id`). A completed order may have both threads.

### Backend flow (automatic — not called by clients)

```text
Customer (mobile)
    │
    ▼
POST {lambdaApiUrl}/api/mobile/user/disputes
    │
    ▼
Lambda: create dispute record (status: open)
    │
    ▼
Lambda → Chat Service: POST /internal/chats/dispute
    │
    ▼
Chat Service: create chat (type: dispute)
  • participants: customer + order.employee_id
  • assignedTo: employee
  • context: { orderId, disputeId }
  • system message with reason / description
    │
    ▼
Lambda: save dispute.chat_id → return to customer
```

Clients never call the internal VPS provisioning endpoint.

### Mobile (customer app)

#### 1. Raise dispute (creates chat)

```http
POST {lambdaApiUrl}/api/mobile/user/disputes
Authorization: Bearer <customer_jwt>
Content-Type: application/json
```

```json
{
  "order_id": "<completed_order_mongo_id>",
  "reason": "Service not completed properly",
  "description": "Optional longer text"
}
```

**Requirements** — same as [Order eligibility](#order-eligibility-which-orders-can-get-a-dispute-chat) above:

- Order belongs to the logged-in customer.
- `order_status` must be **`completed`**.
- Order must have **`employee_id`**.
- Only **one open dispute** per order (`open` or `in_review`; `409` if one already exists — use `record.chat_id` from the response to reopen the thread).

**Success `201`**

```json
{
  "success": true,
  "status": 201,
  "message": "Dispute raised successfully.",
  "record": {
    "_id": "...",
    "chat_id": "674a1b2c3d4e5f6789012345",
    "order_id": "...",
    "employee_id": "...",
    "status": "open"
  }
}
```

#### 2. Open chat and message

Use `record.chat_id` on the **Chat Service**:

1. Connect socket → `{chatServiceUrl}`
2. `join_chat(chat_id)`
3. `GET {chatServiceUrl}/api/chat/messages?chatId=…` (bootstrap history)
4. `send_message` / `receive_message` for live messaging
5. Upload attachments via `{lambdaApiUrl}/api/document_upload/files` with `type: 7`, then send `fileUrl` in the message (see [§4 Attachments](#attachments-images--documents))

#### 3. List or reopen existing dispute

```http
GET {lambdaApiUrl}/api/mobile/user/disputes
GET {lambdaApiUrl}/api/mobile/user/disputes/:disputeId
Authorization: Bearer <customer_jwt>
```

Both return `chat_id` — use it to open the same thread (no new chat is created).

### Web (admin / employee)

Web has **no** `POST /api/dispute/create`. Franchise admin and employees open existing dispute threads; **super admin** and **staff** may **read** any dispute chat platform-wide but cannot message or transfer.

#### 1. Find dispute

```http
GET {lambdaApiUrl}/api/dispute/getAll?page=1&limit=10
GET {lambdaApiUrl}/api/dispute/get/:disputeId
Authorization: Bearer <admin_or_employee_jwt>
```

Response includes **`chat_id`**.

#### 2. Open chat (Chat Service)

1. Connect socket → `{chatServiceUrl}`
2. `join_chat(dispute.chat_id)`
3. `GET {chatServiceUrl}/api/chat/:id` (optional metadata)
4. `GET {chatServiceUrl}/api/chat/messages?chatId=…`
5. `send_message` for replies

Show **`assignedToUser`** in the thread header (employee handling the dispute).

#### 3. Update dispute status (Lambda)

```http
PUT {lambdaApiUrl}/api/dispute/update/:id
Authorization: Bearer <admin_or_employee_jwt>
Content-Type: application/json
```

```json
{ "status": "in_review" | "resolved" | "closed" }
```

| Status | Chat side effect |
|--------|------------------|
| `in_review` | System message: “Dispute is now in review.” |
| `resolved` / `closed` | System message + linked chat `status` set to **`closed`** — see [§13 Closing chats](#13-closing-chats) |

Customers **cannot** update dispute status (`403`).

#### 4. Reassign handler (optional)

```http
POST {chatServiceUrl}/api/chat/:chatId/transfer
```

```json
{ "newAssignedTo": "<employee_mongo_id>" }
```

Or socket **`transfer_chat`**. For disputes this is a **full handoff**: customer stays; previous employee is removed from `participants`; new employee is added; `assignedTo` and `dispute.employee_id` are updated. Prior messages stay on the same `chatId`. See [§9 Transfer chat](#9-transfer-chat-reassign-handler) for permissions and per-type behavior.

### Web vs mobile summary

| Step | Mobile (customer) | Web (admin / employee) |
|------|-------------------|------------------------|
| **Start dispute chat** | `POST {lambda}/api/mobile/user/disputes` | Not available — customer must raise first |
| **Get `chat_id`** | From raise / list / get dispute | From `GET /api/dispute/getAll` or `get/:id` |
| **Messaging** | `{chatServiceUrl}` socket + `/api/chat/messages` | Same |
| **File upload** | `{lambda}/api/document_upload/files` `type: 7` | Same |
| **Update status** | Not allowed (`403`) | `PUT {lambda}/api/dispute/update/:id` |
| **Transfer employee** | Not typical | `POST {chatService}/api/chat/:id/transfer` |

### UI flows

**Mobile:** Completed order → “Raise dispute” → `POST /disputes` → navigate to chat screen with `record.chat_id`.

**Web:** Disputes list or notification → open dispute detail → read `chat_id` → `join_chat` → message thread. Employee replies immediately; admin may update status or transfer.

### Common mistakes

| Mistake | Fix |
|---------|-----|
| Calling `POST /api/chat/support` to start a dispute | Use `POST /api/mobile/user/disputes` (customer only) |
| Admin trying to “create” a dispute chat | Open existing `chat_id` from dispute record |
| Using `order.chat_id` for a dispute | Use **`dispute.chat_id`** (separate thread) |
| Raising dispute before order is completed | Wait until `order_status = completed` — see [§7 Order eligibility](#order-eligibility-which-orders-can-get-a-dispute-chat) |
| Polling dispute APIs for new messages | Use Socket.IO on `{chatServiceUrl}` |

### Inbox filtering

Dispute threads appear in `GET {chatServiceUrl}/api/chat` with `type: "dispute"`. Optional filter: `?type=dispute&status=open`.

---

## 8. General support chat

**Customer — POST** `/api/mobile/user/chats/support`

```json
{
  "franchise_id": "OPTIONAL",
  "initial_message": "I need help"
}
```

The customer **does not choose an employee**. The backend:

1. **Resumes** an existing **open** support chat for that customer (same thread, same handler).
2. If none exists, **auto-assigns** an employee in the customer’s franchise using **load balancing** — the employee with the **fewest open support chats** gets the new chat (ties spread fairly across equally loaded employees).
3. Eligible employees: active, `chat !== false`, same franchise.

Franchise is resolved from `franchise_id` (optional body), customer profile, or latest order.

Response includes `assignedToUser` so the app can show who they’re chatting with.

**Back-office — POST** `/api/chat/support`

```json
{
  "customer_id": "<required for admin/employee>",
  "employee_id": "<required when admin starts chat for another employee>",
  "initial_message": "Hi, how can I help?"
}
```

Only **franchise admin** and **employee** may call this endpoint. **Super admin** and **staff** are read-only observers and cannot start support chats (`403` `CHAT_READ_ONLY`).

Franchise admin / employee may target a specific `employee_id`. Customers use mobile auto-assign only. Returns existing **open** support chat for the customer when one exists, or creates customer + employee pair when `employee_id` is specified.

Auto-assign on create always picks an **employee** (`type: 3`) via load balancing — not franchise admin. Admin becomes handler only through [transfer](#9-transfer-chat-reassign-handler).

---

## 9. Transfer chat (reassign handler)

Reassign the **handler** (`assignedTo`) for a chat. Used mainly on **web** (franchise admin / assigned handler) — customers, partners, super admin, and staff **cannot** transfer.

**Host:** `{chatServiceUrl}` only (not Lambda).

### API

**REST**

```http
POST {chatServiceUrl}/api/chat/:chatId/transfer
Authorization: Bearer <jwt>
Content-Type: application/json
```

**Socket (preferred when thread is open)**

```json
{
  "chatId": "<mongo_chat_id>",
  "newAssignedTo": "<employee_or_franchise_admin_mongo_id>"
}
```

Emit: **`transfer_chat`**  
Listen: **`chat_assigned`**, **`chat_updated`**, **`receive_message`** (system line).

**Pick transfer targets (support / dispute):** load eligible users from the chat’s franchise:

- `GET {lambdaApiUrl}/api/user/getAll?type=3` — employees (`is_active`, `chat !== false`)
- `GET {lambdaApiUrl}/api/user/getAll?type=1` — franchise admin(s) for that franchise (same filters)

Merge and dedupe for the picker. Exclude current `assignedTo`. There is no dedicated chat transfer-targets endpoint.

For **order** chats, `type=3` employees are usually sufficient.

### Which chats can be transferred?

All chat types support transfer at the API level. Behavior depends on `chat.type`:

| Chat type | Transfer behavior |
|-----------|-------------------|
| **`support`** | **Full handoff** — customer stays; previous handler removed from `participants`; new handler added; `assignedTo` updated; `isGroup: false`; system message posted. Previous handler may **read** but not **send** until transferred back. |
| **`dispute`** | Same as support **plus** `dispute.employee_id` updated in MongoDB (stores handler id even when handler is franchise admin) |
| **`order`** | Only **`assignedTo`** changes — group **participants unchanged** (customer, partner, employee, franchise admin) |
| **`quote`** (if used) | Same as order — only `assignedTo` changes |

Prior messages always stay on the **same** `chatId` — transfer does not create a new thread.

**Typical use**

| Chat type | Who usually transfers | Why |
|-----------|----------------------|-----|
| Support | Franchise admin, assigned handler | Hand off to another agent or take over as admin |
| Dispute | Franchise admin, assigned handler | Reassign dispute handler |
| Order | Franchise admin, assigned employee | Change handling employee without reshaping the group |

Closed chats are **not** blocked by the server today — hide or disable transfer in UI when `chat.status === "closed"` if that matches product rules.

### Who can transfer?

Transfer requires **manage** permission. Rules differ for **support/dispute** vs **order**:

#### Support and dispute

| Role | Can transfer? |
|------|----------------|
| **Franchise admin** (`type: 1`) | **Yes** — any support/dispute in their franchise (even when not the handler) |
| **Assigned handler** (`assignedTo` matches caller) | **Yes** — employee or franchise admin |
| **Previous handler** (after transfer) | **No** |
| **Super admin** (`type: 5`) | **No** — read-only |
| **Staff** (`type: 6`) | **No** — read-only |
| **Customer** (`type: 4`) | **No** |
| **Partner** (`type: 2`) | **No** |

#### Order (and other group types)

| Role | Can transfer? |
|------|----------------|
| **Franchise admin** (franchise-scoped) | **Yes** |
| **Assigned employee** (`assignedTo`) | **Yes** |
| **Employee / admin** with `roles[].role` = `"employee"` or `"admin"` on that chat | **Yes** |
| **Super admin / staff** | **No** — read-only |
| **Customer / partner** | **No** |

**Mobile:** do not show transfer UI to customers.  
**Web:** show transfer on support, dispute, and order threads for franchise admin and the assigned handler (support/dispute), or eligible roles on order groups.

### Who can be the new handler? (support / dispute)

| Actor transferring | Valid `newAssignedTo` targets |
|--------------------|------------------------------|
| **Assigned employee** | Other active franchise **employees** (`type: 3`) **or** franchise **admin** (`type: 1`) |
| **Franchise admin** | Other franchise **employees** **or self** (self-transfer — admin becomes handler and can chat) |

#### New assignee rules (support / dispute)

| Rule | Error if violated |
|------|-------------------|
| `newAssignedTo` must be an active **employee** (`type: 3`) **or franchise admin** (`type: 1`) | `400` Invalid assignee |
| User must have **`chat !== false`** | `403` Not available for chat |
| Must be in the **same franchise** as the chat (when franchise is known) | `403` Franchise mismatch |
| Chat must include a **customer** in `participants` | `409` Chat invalid |
| Same as current `assignedTo` | No-op (chat returned unchanged) |

**After transfer:** only the new handler and the customer remain in `participants`. The previous handler (employee or admin) keeps **read-only** franchise-scoped access.

#### Order (and other non-handoff types)

- Only `assignedTo` is updated.
- Employee / franchise validation for `newAssignedTo` is **not** enforced in code today — still pass a valid employee id from your picker.

### Response and UI events

On success:

1. Chat record updated (`assignedTo`, and for support/dispute: `participants`, `isGroup`).
2. **System message** posted: `"Chat transferred from … to …"`.
3. Socket emits **`receive_message`** (system bubble), **`chat_assigned`**, **`chat_updated`**.

REST `200`:

```json
{
  "success": true,
  "status": 200,
  "message": "Chat transferred successfully.",
  "record": { "...": "updated chat with assignedToUser, participantUsers" }
}
```

Update thread header from `record.assignedToUser` after transfer.

### Common mistakes

| Mistake | Result |
|---------|--------|
| Customer calls transfer | `403` No manage permission |
| Super admin / staff calls transfer | `403` No manage permission (read-only) |
| Transfer to user from another franchise (support/dispute) | `403` Franchise mismatch |
| Transfer to user with `chat: false` | `403` Not available for chat |
| Transfer support/dispute to partner or customer | `400` Invalid assignee |
| Previous handler tries to send after transfer | `403` `CHAT_READ_ONLY` |
| Expecting order group members to change on transfer | Only `assignedTo` changes for `order` |
| Calling Lambda instead of Chat Service | Wrong host — transfer is VPS-only |

---

## 10. UI mapping (suggested)

| Screen | Primary | REST (bootstrap / fallback) |
|--------|---------|----------------------------|
| App session | **Connect socket** once | — |
| Order detail → Chat tab | `join_chat` | `order.chat_id` or `GET /by-order/:orderId` to get `chatId` |
| Completed order → Raise dispute | — (Lambda) | `POST /disputes` → navigate to `chat_id` (see [§7](#7-dispute-chats)) |
| Support / Help | `join_chat` after create | `POST …/chats/support` or `/api/chat/support` |
| Chat inbox | Refresh list on `receive_message` / `messages_read` | `GET /api/chat` on open / pull-to-refresh |
| Chat thread — live | **`send_message` → `message_sent`**; others via `receive_message` | `GET /messages` once on open; `before` on scroll-up only |
| Support/dispute compose | Show input only if `assignedTo === me` or customer | Server returns `403` `CHAT_READ_ONLY` otherwise |
| Failed message | **`chat_error`** + retry same payload | REST `success: false` + retry `POST /messages` |
| Typing indicator | **`typing_start` / `typing_stop`** | — |
| Delivery / read ticks | **`message_delivered` / `read_messages`** | REST only if socket down |
| Online / last seen | **`presence_updated`** | `GET /presence/...` on thread open |
| Edit / delete bubble | **`edit_message` / `delete_message`** | `PATCH` / `DELETE` if socket down |
| Unread badge | Update on `receive_message`; clear via **`read_messages`** | `unreadCount` from inbox `GET` |
| Reassign support/dispute/order | `transfer_chat` or REST | `POST /:id/transfer` — see [§9](#9-transfer-chat-reassign-handler) |
| Transfer picker (web, support/dispute) | — | `getAll?type=3` + `getAll?type=1` (franchise); exclude current `assignedTo` |

---

## 11. Push notifications

New chat messages trigger FCM push to **offline** participants only (user has no active Socket.IO connection). Online users rely on realtime socket events. Push type `Chat`; data includes `chat_id`, `order_id` when applicable.

---

## 12. Flutter / mobile (customer app)

The **same rules as §3–§4 apply** — Socket.IO first, REST for bootstrap/fallback only. Flutter is not a separate chat API; only **which host** you call differs for orders/disputes vs chat.

### Environment config

Store two base URLs in app config (`.env`, flavors, etc.):

| Key | Example | Used for |
|-----|---------|----------|
| `lambdaApiUrl` | `https://api.example.com` | Login, orders, `POST/GET /api/mobile/user/disputes` |
| `chatServiceUrl` | `http://13.201.79.72` | Socket.IO, `GET /api/chat`, messages, support chat |

**Customer JWT** (`type: 4`) from login works on both hosts.

### Mobile endpoint map

| Action | Method | URL |
|--------|--------|-----|
| Inbox | `GET` | `{chatServiceUrl}/api/chat` |
| Order chat by order | `GET` | `{chatServiceUrl}/api/chat/by-order/:orderId` |
| Message history / fallback send | `GET` / `POST` | `{chatServiceUrl}/api/chat/messages` |
| Start support chat | `POST` | `{chatServiceUrl}/api/mobile/user/chats/support` |
| Raise dispute | `POST` | `{lambdaApiUrl}/api/mobile/user/disputes` — see [§7](#7-dispute-chats) |
| List / get dispute | `GET` | `{lambdaApiUrl}/api/mobile/user/disputes` |
| Socket.IO | connect | `{chatServiceUrl}` |

Support chat may also be called via `{lambdaApiUrl}/api/mobile/user/chats/support` (Lambda proxies to Chat Service). Prefer **`chatServiceUrl` direct** for lower latency when possible.

### Recommended packages

| Purpose | Package |
|---------|---------|
| Socket.IO | [`socket_io_client`](https://pub.dev/packages/socket_io_client) |
| REST | [`dio`](https://pub.dev/packages/dio) or `http` |
| FCM | [`firebase_messaging`](https://pub.dev/packages/firebase_messaging) |
| UUID for `clientMessageId` | [`uuid`](https://pub.dev/packages/uuid) |

### Socket connection (Flutter)

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

IO.Socket connectChatSocket(String chatServiceUrl, String jwt) {
  return IO.io(
    chatServiceUrl,
    IO.OptionBuilder()
        .setTransports(['websocket'])
        .disableAutoConnect()
        .setAuth({'token': jwt})
        .build(),
  )..connect();
}
```

Listen for the same events as web: `connection_status`, `message_sent`, `receive_message`, `chat_error`, `messages_read`, `typing_start`, `typing_stop`, `presence_updated`.

Emit with the same payloads: `join_chat`, `send_message` (include `clientMessageId`), `read_messages`, etc.

### App lifecycle

Mobile OS may suspend or kill the socket when the app is backgrounded.

| Event | What to do |
|-------|------------|
| **App start / login** | Connect socket once; `GET /api/chat` for inbox |
| **Open chat thread** | `GET /messages` (once) → `join_chat(chatId)` → `read_messages`; header from `assignedToUser.name` |
| **App resume** (`AppLifecycleState.resumed`) | If socket disconnected, reconnect → re-`join_chat` all active threads → `GET /messages?after=…` to fill gaps |
| **App pause / background** | Keep socket if possible; expect disconnect on some devices |
| **User sends while offline** | `POST /messages` fallback with `clientMessageId` |

Use `WidgetsBindingObserver` (or your state layer) to reconnect on resume.

### Multiple order chats

One customer, many orders → many `chatId`s. One socket connection is enough.

**Option A (recommended):** On inbox load, `join_chat` for every chat in the list so `receive_message` updates badges in real time.

**Option B:** `join_chat` only for the open thread; refresh inbox (`GET /api/chat`) when user returns to the list.

Remember: FCM is skipped while **any** socket is connected — background chats won't get push if the user is online but not joined to those rooms.

### FCM tap → open chat

Push `data` payload (when app was offline):

```json
{
  "type": "Chat",
  "chat_id": "<mongo_chat_id>",
  "message_id": "<mongo_message_id>",
  "order_id": "<optional>"
}
```

On notification tap:

1. Navigate to chat screen with `chat_id`.
2. Ensure socket is connected and `join_chat(chat_id)`.
3. Load history `GET /messages?chatId=…` if thread not already loaded.

Register `device_token` on login (existing user profile API) so the server can send FCM.

### Failed send (Flutter)

Same as §4 — optimistic UI with local `clientMessageId`:

```dart
final clientMessageId = const Uuid().v4();

socket.emit('send_message', {
  'chatId': chatId,
  'type': 'text',
  'content': text,
  'clientMessageId': clientMessageId,
});

// Listen:
// message_sent → match clientMessageId → status sent
// chat_error   → match clientMessageId → status failed, show Retry
```

### HTTP / TLS (dev VPS)

If `chatServiceUrl` is plain `http://` (e.g. `http://13.201.79.72`):

- **Android:** allow cleartext for that host in `network_security_config.xml` (dev only).
- **iOS:** ATS exception in `Info.plist` (dev only).

Use **HTTPS** on production Chat Service and drop cleartext exceptions.

### Flutter checklist

- [ ] Two base URLs configured (`lambdaApiUrl`, `chatServiceUrl`)
- [ ] Socket connects with customer JWT; not polling messages
- [ ] `join_chat` on thread open (or all inbox chats)
- [ ] `clientMessageId` on every outbound message
- [ ] Reconnect + re-join on app resume
- [ ] FCM tap navigates using `chat_id` from payload
- [ ] Thread header uses `assignedToUser` / `participantUsers`; bubbles use `senderUser`

---

## 13. Closing chats

Chat `status` is one of: **`open`**, **`closed`**, **`pending`**. Closing is **not** the same as leaving a thread — it marks the conversation as finished in the inbox (`?status=open` filters closed chats out).

**Host:** status changes use **`{chatServiceUrl}`** except dispute auto-close, which is triggered from **Lambda** when dispute status is updated.

### Who can close a chat?

Uses the same **manage** permission as transfer ([§9](#9-transfer-chat-reassign-handler)):

| Role | Can close via `PATCH /api/chat/:id/status`? |
|------|---------------------------------------------|
| **Franchise admin** (franchise-scoped) | **Yes** — support/dispute in franchise; order per group rules |
| **Assigned handler** (`assignedTo`) on support/dispute | **Yes** |
| **Assigned employee** / manage role on **order** group | **Yes** |
| **Super admin** | **No** — read-only |
| **Staff** | **No** — read-only |
| **Customer** | **No** |
| **Partner** | **No** |

Customers cannot close order, dispute, or support chats through the API today.

### API — manual close / reopen

```http
PATCH {chatServiceUrl}/api/chat/:chatId/status
Authorization: Bearer <jwt>
Content-Type: application/json
```

```json
{ "status": "closed" }
```

Reopen with `{ "status": "open" }`. `pending` is also allowed but rarely used in UI.

**Who typically uses this:** franchise admin or assigned employee on **web** — e.g. “Close conversation” on support or order threads.

There is **no** Socket.IO event for close — use REST `PATCH` (or refresh chat metadata after close).

### By chat type — when does a chat close?

| Chat type | Automatic close | Manual close |
|-----------|-----------------|--------------|
| **`dispute`** | **Yes** — when dispute is set to **`resolved`** or **`closed`** via Lambda `PUT /api/dispute/update/:id` | Admin/employee may also `PATCH` chat status |
| **`order`** | **No** — order completion does **not** close the group chat | Admin/employee `PATCH` only |
| **`support`** | **No** | Admin/employee `PATCH` only |
| **`quote`** (if used) | **No** | Admin/employee `PATCH` only |

#### Dispute chats (automatic)

When back-office updates dispute status on **Lambda**:

```http
PUT {lambdaApiUrl}/api/dispute/update/:disputeId
Authorization: Bearer <admin_or_employee_jwt>
```

```json
{ "status": "resolved" }
```

or `"closed"`.

Lambda calls Chat Service internally → linked dispute chat `status` becomes **`closed`**, system message posted (`"Dispute marked as resolved."` / `"…closed."`).

| Dispute status change | Chat effect |
|----------------------|-------------|
| → `in_review` | Chat stays **open**; system message only |
| → `resolved` or `closed` | Chat set to **`closed`** + system message |
| Reopen dispute status to `open` | Chat is **not** auto-reopened — use `PATCH` with `"open"` if product allows |

Customers **cannot** call `PUT /api/dispute/update` (`403`).

#### Order chats (manual only)

- Created when the order is created; stays **`open`** when the order moves to **`completed`**, **`cancelled`**, etc.
- There is **no** auto-close tied to order lifecycle in code today.
- Franchise admin or assigned employee may close via `PATCH` when the conversation should end (product decision).
- **Partners and customers** cannot close the group chat.

#### Support chats (manual only)

- Close only via `PATCH` by **franchise admin** (franchise scope) or **assigned handler** on support/dispute.
- Starting a **new** support chat later uses load balancing / resume rules ([§8](#8-general-support-chat)) — separate from closing an old thread.

### After a chat is closed

| Behavior | Detail |
|----------|--------|
| **Inbox** | Filter with `GET /api/chat?status=open`; closed threads drop out unless you omit the filter |
| **Read access** | Users with read scope can still **open history** (`GET /messages`, `GET /:id`) |
| **Send messages** | On **support/dispute**, server blocks non-handlers with `403` `CHAT_READ_ONLY`. On all types, **disable compose in UI** when `chat.status === "closed"` |
| **Transfer** | Not blocked server-side for eligible roles — hide transfer when closed ([§9](#9-transfer-chat-reassign-handler)) |

### UI recommendations

| Chat type | Show “Close” to | When to show |
|-----------|-----------------|--------------|
| **Dispute** | Admin, employee | Optional manual close; usually let **Resolve / Close dispute** on Lambda close the chat automatically |
| **Order** | Admin, assigned employee | After order is complete and conversation is done (manual) |
| **Support** | Admin, assigned employee | When issue is resolved (manual) |
| **All** | Customer | **Do not show** close — customers cannot close |

### Common mistakes

| Mistake | Fix |
|---------|-----|
| Customer expects “end chat” to close server-side | Only franchise admin or assigned handler with manage permission can `PATCH` status |
| Assuming order completion closes order chat | It does not — close manually if needed |
| Resolving dispute but chat still open | Ensure Lambda `CHAT_SERVICE_ENABLED` and dispute update path ran; check dispute `chat_id` |
| Closed chat still accepts sends | Block send in client UI until server enforces closed threads |

---

## 14. Notes

- **Do not poll** `GET /messages` for new messages — that is what Socket.IO is for.
- Chat REST + Socket.IO run on the **Chat Service VPS**, not Lambda. Use `{chatServiceUrl}` for all chat endpoints.
- Disputes and orders remain on **Lambda** — only `chat_id` and provisioning are shared. Full dispute chat flow: [§7](#7-dispute-chats).
- Dispute and support chats are **1:1** (customer + handler — employee or franchise admin when assigned). Order chats are **group**.
- Closing chats: [§13](#13-closing-chats). Dispute resolve/close auto-closes linked chat via Lambda → Chat Service internal API.
