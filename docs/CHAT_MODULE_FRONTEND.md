# Chat — frontend integration guide

Realtime messaging for **order group chats**, **disputes** (completed orders), and **general support** (customer ↔ employee).

Applies to **admin/employee web**, **Flutter customer mobile**, and any client using the same JWT + Socket.IO protocol.

Postman: **`postman/Help-PR-All-APIs.postman_collection.json`** → **39 — Chat** (REST), **45 — Dispute**, and **Mobile → User → Chat & Disputes**.

---

## 1. Chat types

| Type | `chat.type` | Participants | Created when |
|------|-------------|--------------|--------------|
| Order | `order` | Customer, partner, assigned employee, franchise admin | **Automatically** on order create |
| Dispute | `dispute` | Customer + order employee | Customer raises dispute on a **completed** order |
| General / support | `support` | Customer + employee | Customer or employee starts support chat |

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
| **Franchise admin / Staff** | Above **plus** all franchise chats (orders, disputes, support for that franchise) |
| **Super admin** | **All chats** platform-wide (paginated, default `limit=50`) |

Super admin is not auto-added as a chat participant, so the inbox uses platform-wide listing instead of participant-only matching.

Optional query params: `type`, `status`, `page`, `limit` (max 200).

---

Chat and message APIs include **display fields** so clients can show who is in the thread without extra user lookups.

**On every chat `record` / inbox item** (also on `chat_updated`, `chat_assigned`, support create):

| Field | Purpose |
|-------|---------|
| `assignedTo` | Handler user id (unchanged) |
| `assignedToUser` | `{ _id, name, type, profile_url, role }` — use for **support/dispute header** (employee name) |
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
| `PATCH` | `/:id/status` | Close/reopen chat `{ "status": "closed" }` |
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

## 7. Raise dispute (customer)

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
  "customer_id": "<required for staff>",
  "employee_id": "<required when admin starts chat for another employee>",
  "initial_message": "Hi, how can I help?"
}
```

Staff may target a specific employee; customers cannot. Returns existing **open** support chat for the customer when using auto-assign, or customer + employee pair when staff specifies `employee_id`.

---

## 9. Transfer chat (reassign handler)

**POST** `/api/chat/:id/transfer` or socket **`transfer_chat`**

```json
{
  "newAssignedTo": "<employee_mongo_id>"
}
```

| Chat type | Behavior |
|-----------|----------|
| `support`, `dispute` | **Full handoff** — customer stays; previous employee removed from `participants`; new employee added; `assignedTo` updated; `isGroup: false`. For disputes, `dispute.employee_id` is updated too. Prior messages stay on the same `chatId`. |
| `order` (and others) | Only **`assignedTo`** changes; group participants are unchanged. |

Validation for support/dispute handoff:

- New assignee must be an **active employee** with `chat !== false`.
- Employee must belong to the **same franchise** as the chat.
- Customer must remain a participant.

On success, backend posts a **system message** (`type: "system"`) and emits **`receive_message`** so open threads show the transfer line. Also listen for **`chat_assigned`** and **`chat_updated`**.

---

## 10. UI mapping (suggested)

| Screen | Primary | REST (bootstrap / fallback) |
|--------|---------|----------------------------|
| App session | **Connect socket** once | — |
| Order detail → Chat tab | `join_chat` | `order.chat_id` or `GET /by-order/:orderId` to get `chatId` |
| Completed order → Raise dispute | — (Lambda) | `POST /disputes` → navigate to `chat_id` |
| Support / Help | `join_chat` after create | `POST …/chats/support` or `/api/chat/support` |
| Chat inbox | Refresh list on `receive_message` / `messages_read` | `GET /api/chat` on open / pull-to-refresh |
| Chat thread — live | **`send_message` → `message_sent`**; others via `receive_message` | `GET /messages` once on open; `before` on scroll-up only |
| Failed message | **`chat_error`** + retry same payload | REST `success: false` + retry `POST /messages` |
| Typing indicator | **`typing_start` / `typing_stop`** | — |
| Delivery / read ticks | **`message_delivered` / `read_messages`** | REST only if socket down |
| Online / last seen | **`presence_updated`** | `GET /presence/...` on thread open |
| Edit / delete bubble | **`edit_message` / `delete_message`** | `PATCH` / `DELETE` if socket down |
| Unread badge | Update on `receive_message`; clear via **`read_messages`** | `unreadCount` from inbox `GET` |
| Reassign support/dispute | `transfer_chat` or REST | `POST /:id/transfer` |

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
| Raise dispute | `POST` | `{lambdaApiUrl}/api/mobile/user/disputes` |
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

## 13. Notes

- **Do not poll** `GET /messages` for new messages — that is what Socket.IO is for.
- Chat REST + Socket.IO run on the **Chat Service VPS**, not Lambda. Use `{chatServiceUrl}` for all chat endpoints.
- Disputes and orders remain on **Lambda** — only `chat_id` and provisioning are shared.
- Dispute and support chats are **1:1** (customer + employee). Order chats are **group**.
- Closing a resolved dispute also closes the linked chat (`status: closed`) via Lambda → Chat Service internal API.
