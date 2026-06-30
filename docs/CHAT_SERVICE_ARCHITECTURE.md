# Chat Service Architecture (Lambda + VPS)

This document describes the target architecture for extracting the chat system from the Lambda monolith into a dedicated **Chat Service** on a VPS (e.g. AWS Lightsail). It supersedes the in-process chat wiring described in `server.js` for production.

**Related docs:** `docs/CHAT_MODULE_FRONTEND.md` (client integration), `help-pr-chat-service` (Chat Service implementation).

**Lambda:** `src/modules/chat/` has been removed from the monolith; chat runs on VPS only.

---

## 1. Principles

| Layer | Owns |
|-------|------|
| **Lambda** | Business workflows: orders, users, payments, dispute **records**, auth, notifications (in-app) |
| **Chat Service (VPS)** | Everything chat-related: provisioning, REST, Socket.IO, messages, FCM push |
| **MongoDB** | Shared datastore; **only the Chat Service writes** chat collections |
| **Clients** | Lambda for business operations; Chat Service for all chat operations |

**Hard rules**

- Lambda must **not** import `src/modules/chat/`, chat Mongoose models, or mount `/api/chat` routes.
- Lambda triggers chat creation only via **HTTP** to Chat Service internal APIs (`POST /internal/chats/*`).
- Chat listing, messaging, transfer, and sockets are **VPS-only**.
- Business entities (order, dispute) must be **committed to MongoDB** before Lambda calls provisioning APIs.

---

## 2. VPS Chat Module — internal structure

The Chat Service is a **standalone Express.js** application. It is not Socket.IO alone.

```
┌─────────────────────────────────────────────────────────┐
│                  Chat Service (VPS)                      │
├─────────────────────────────────────────────────────────┤
│  Socket.IO Server      ← real-time messaging            │
│  REST APIs             ← /api/chat/* (public)           │
│  Provision APIs        ← /internal/chats/* (Lambda)     │
│  Chat Service layer    ← business logic                   │
│  FCM Notifications     ← push on new messages           │
│  Authentication        ← JWT validation (shared secret) │
│  MongoDB access        ← chats, messages, read_tracking │
└─────────────────────────────────────────────────────────┘
```

**NPM stack (minimum):** `express`, `mongoose`, `socket.io`, `jsonwebtoken`, `express-validator`, `firebase-admin`, `cors`, `dotenv`.

---

## 3. Overall system flow

```
                Mobile / Admin
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
  Lambda API                  Chat Service (VPS)
  Orders / Users / Payments   Socket.IO + Chat APIs
        │                             │
        │  POST /internal/chats/*     │
        └──────────────►──────────────┘
                       │
                       ▼
                   MongoDB (shared)
```

- **Lambda** owns business workflows.
- **Chat Service** owns everything chat-related.
- **MongoDB** is shared; chat collections are VPS-write-only.
- **Clients** use Lambda for business operations and the Chat Service for chat operations.

---

## 4. Provisioning flows (Lambda → VPS)

### 4.1 Order chat — create (no race condition)

The order document **must exist in MongoDB** before the Chat Service reads it.

```
Customer
      │
      ▼
   Lambda
      │
 Create Order
      │
 Commit Order          ← await save; order exists in MongoDB
      │
 POST /internal/chats/order
      │
      ▼
 Chat Service (VPS)
      │
 Read Order
      │
 Create Chat
      │
 Return chatId
      │
      ▼
   Lambda
      │
 Update order.chat_id  ← optional if VPS writes this field
      │
      ▼
 Customer response
```

**Replaces today:** `services/order_creation_service.js` → `safeCreateOrderChatForOrder`.

**Rules**

- Never call the internal API before order commit completes.
- Endpoint must be **idempotent** (return existing chat if one already exists for `orderId`).
- On VPS failure: retry via queue or compensating job; the order still exists.

---

### 4.2 Order chat — sync participants

Triggered when order employee or related participants change.

```
Lambda (order update committed)
      │
 POST /internal/chats/order/sync
      │
      ▼
 VPS → read order → sync chat participants → return chat
```

**Replaces today:** `controllers/order_controller.js` → `safeSyncOrderChatForOrder`.

---

### 4.3 Dispute chat — create

```
Customer raises dispute
      │
      ▼
   Lambda
      │
 Create dispute record
      │
 Commit dispute
      │
 POST /internal/chats/dispute
      │
      ▼
 VPS → read dispute/order → create chat → return chatId
      │
      ▼
 Lambda → update dispute.chat_id
```

**Replaces today:** `services/dispute_service.js` → `createDisputeChat`, `createSystemMessage` on raise.

If chat creation fails, Lambda should roll back or mark the dispute failed (current behavior deletes the dispute when chat creation fails).

---

### 4.4 Dispute status → chat side effects

```
Admin
      │
 PUT /api/dispute/update/:id   (Lambda)
      │
 Lambda updates disputes collection
      │
 POST /internal/chats/dispute-status
      │
 VPS: close chat, system message, socket broadcast, FCM
```

**Replaces today:** `dispute_service.updateDisputeStatus` → `Chat.updateOne`, `createSystemMessage`.

Lambda owns the **dispute record**; VPS owns **chat side effects**.

---

## 5. Runtime flows (most common — VPS only)

These are the primary day-to-day operations after a chat exists.

### 5.1 Inbox / list chats

```
Mobile / Admin
        │
   GET /api/chat
        │
        ▼
 Chat Service (VPS)
        │
   Read chats + unread counts
        │
        ▼
      MongoDB
        │
        ▼
   Return inbox to client
```

### 5.2 Open a chat (real-time)

```
Mobile / Admin
       │
  Socket.IO connect (JWT)
       │
  emit join_chat { chatId }
       │
       ▼
 Chat Service (VPS)
       │
  assertChatAccess
       │
  socket.join(chatId)
```

Optional REST: `GET /api/chat/:id`, `GET /api/chat/messages?chatId=`.

### 5.3 Send message (primary path)

```
Client
      │
 emit send_message { chatId, content, type, ... }
      │
      ▼
 Socket.IO (VPS)
      │
 Chat Service
      │
 Save message ──────────► MongoDB (chat_messages)
      │
 Update chat.lastMessage ► MongoDB (chats)
      │
 FCM push ─────────────► recipients (background)
      │
 io.to(chatId).emit("receive_message")
      │
      ▼
 All joined clients (broadcast)
```

**REST fallback** when Socket.IO is unavailable:

```
POST /api/chat/messages  →  same save + FCM + emitToChat path
```

### 5.4 Read receipts

```
Client
      │
 emit read_messages { chatId }
      │
      ▼
 VPS → update chat_read_tracking → MongoDB
```

---

## 6. API ownership

### 6.1 Lambda — public routes (no chat)

| Operation | Route | Notes |
|-----------|-------|-------|
| Create / update order | `/api/order/*` | After commit → `POST /internal/chats/order` or `/sync` |
| Raise dispute (record) | `POST /api/mobile/user/disputes` | After commit → `POST /internal/chats/dispute` |
| List / get dispute | `GET /api/dispute/*`, mobile dispute GETs | Dispute domain stays on Lambda |
| Update dispute status | `PUT /api/dispute/update/:id` | Then → `POST /internal/chats/dispute-status` |
| Auth, payments, users | existing Lambda routes | Unchanged |

Lambda **never** exposes `GET /api/chat` or writes to chat collections.

---

### 6.2 Chat Service (VPS) — public client routes

Mounted at `{chatBaseUrl}/api/chat` (and mobile paths as needed).

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/chat` | Inbox + unread counts |
| `GET` | `/api/chat/:id` | Single chat |
| `GET` | `/api/chat/by-order/:orderId` | Order group chat |
| `GET` | `/api/chat/messages` | Message history |
| `POST` | `/api/chat/messages` | Send message (REST fallback) |
| `PATCH` | `/api/chat/:id/status` | Open / close / pending |
| `POST` | `/api/chat/:id/transfer` | Reassign handler |
| `POST` | `/api/chat/:id/convert` | Change type/context |
| `POST` | `/api/chat/:id/members` | Add participants |
| `DELETE` | `/api/chat/:id/members/:userId` | Remove participant |
| `POST` | `/api/chat/support` | Back-office support chat |
| `POST` | `/api/mobile/user/chats/support` | Customer support chat |

**Not on VPS (creation via internal API from Lambda):** manual `POST /api/chat` for order/dispute types if those remain Lambda-orchestrated only. Support chat can stay public on VPS.

---

### 6.3 Chat Service (VPS) — Socket.IO events

| Event | Direction | REST equivalent |
|-------|-----------|-----------------|
| `join_chat` | Client → server | — |
| `leave_chat` | Client → server | — |
| `send_message` | Client → server | `POST /api/chat/messages` |
| `read_messages` | Client → server | — |
| `transfer_chat` | Client → server | `POST /api/chat/:id/transfer` |
| `add_member` | Client → server | `POST /api/chat/:id/members` |
| `remove_member` | Client → server | `DELETE /api/chat/:id/members/:userId` |
| `receive_message` | Server → client | — |
| `chat_assigned`, `chat_updated` | Server → client | — |
| `member_added`, `member_removed` | Server → client | — |
| `chat_error` | Server → client | — |

Auth: JWT in handshake `auth.token` or `Authorization: Bearer` header (`JWT_SECRET` must match Lambda).

---

### 6.4 Chat Service (VPS) — internal routes (Lambda only)

Protected by **service API key** or internal JWT (not end-user tokens).

| Method | Route | When |
|--------|-------|------|
| `POST` | `/internal/chats/order` | After order commit |
| `POST` | `/internal/chats/order/sync` | After order participant change |
| `POST` | `/internal/chats/dispute` | After dispute commit |
| `POST` | `/internal/chats/dispute-status` | After dispute status change |
| `POST` | `/internal/chats/support` | Optional server-side support trigger |

---

## 7. Internal API contracts

### 7.1 Authentication

```
X-Internal-Api-Key: <CHAT_SERVICE_INTERNAL_API_KEY>
```

Or `Authorization: Bearer <internal_service_jwt>`.

Requests without a valid key return `401`.

---

### 7.2 `POST /internal/chats/order`

**Request**

```json
{
  "orderId": "507f1f77bcf86cd799439011"
}
```

VPS loads the order from MongoDB (must already exist).

**Response `201` / `200`**

```json
{
  "ok": true,
  "status": 201,
  "chatId": "507f1f77bcf86cd799439012",
  "created": true
}
```

| Status | Code | When |
|--------|------|------|
| `201` | — | New chat created |
| `200` | — | Existing chat returned (idempotent) |
| `404` | `ORDER_NOT_FOUND` | Order not in DB |
| `409` | `CHAT_PROVISION_FAILED` | No valid participants |
| `500` | `INTERNAL_ERROR` | Unexpected failure |

---

### 7.3 `POST /internal/chats/order/sync`

**Request**

```json
{
  "orderId": "507f1f77bcf86cd799439011"
}
```

**Response `200`**

```json
{
  "ok": true,
  "status": 200,
  "chatId": "507f1f77bcf86cd799439012",
  "synced": true
}
```

| Status | Code | When |
|--------|------|------|
| `404` | `ORDER_NOT_FOUND` | Order missing |
| `404` | `CHAT_NOT_FOUND` | No chat for order (caller may retry `/order`) |

---

### 7.4 `POST /internal/chats/dispute`

**Request**

```json
{
  "disputeId": "507f1f77bcf86cd799439013",
  "orderId": "507f1f77bcf86cd799439011",
  "reason": "optional",
  "description": "optional"
}
```

VPS reads dispute and order from MongoDB.

**Response `201`**

```json
{
  "ok": true,
  "status": 201,
  "chatId": "507f1f77bcf86cd799439014",
  "created": true
}
```

| Status | Code | When |
|--------|------|------|
| `404` | `DISPUTE_NOT_FOUND` | Dispute missing |
| `404` | `ORDER_NOT_FOUND` | Order missing |
| `409` | `INSUFFICIENT_PARTICIPANTS` | Order has no employee |
| `500` | `CHAT_PROVISION_FAILED` | Chat create failed |

---

### 7.5 `POST /internal/chats/dispute-status`

**Request**

```json
{
  "disputeId": "507f1f77bcf86cd799439013",
  "chatId": "507f1f77bcf86cd799439014",
  "status": "resolved",
  "actorUserId": "507f1f77bcf86cd799439015"
}
```

`status`: `open` | `in_review` | `resolved` | `closed`

**Response `200`**

```json
{
  "ok": true,
  "status": 200,
  "message": "Chat side effects applied."
}
```

VPS closes chat when status is `resolved` or `closed`, posts system message, emits socket events, sends FCM.

---

### 7.6 `POST /internal/chats/support` (optional)

**Request**

```json
{
  "customerId": "...",
  "employeeId": "...",
  "franchiseId": "...",
  "initialMessage": "optional",
  "actorUserId": "..."
}
```

**Response `201` / `200`**

```json
{
  "ok": true,
  "status": 201,
  "chatId": "...",
  "created": true
}
```

---

## 8. MongoDB access rules

| Collection | Lambda | Chat Service (VPS) |
|------------|--------|---------------------|
| `orders` | Read / write (business) | Read; optional write `chat_id` |
| `disputes` | Read / write | Read; optional write `chat_id` |
| `users`, `franchises` | Read / write | Read (participants, FCM tokens) |
| `notification_settings` | Read | Read (FCM opt-out) |
| `chats` | **No access** | Read / write |
| `chat_messages` | **No access** | Read / write |
| `chat_read_trackings` | **No access** | Read / write |

**Ownership recommendation:** VPS writes `order.chat_id` and `dispute.chat_id` during provisioning so Lambda only stores business fields it already owns, or Lambda updates from the `chatId` in the API response — pick one approach and use it consistently.

---

## 9. FCM (push notifications)

Messages are saved and broadcast from VPS. Recommended default:

```
VPS: save message → FCM push → Socket.IO broadcast
```

Requires `firebase-admin` and service account credentials on VPS (`resources/adminsdk.json` or env secret).

**Alternative** (no Firebase on VPS):

```
VPS: save message → Socket.IO broadcast
VPS → Lambda POST /internal/notifications/chat-message → FCM
```

Dispute-raised in-app notifications (`safeNotifyDisputeRaised`) remain on **Lambda** (notification module).

---

## 10. Client routing / DNS

**Option A — separate host (recommended)**

```
api.yourapp.com     → Lambda (API Gateway)
chat.yourapp.com    → VPS (REST + Socket.IO, same port)
```

**Option B — path-based gateway**

```
api.yourapp.com/api/order/*      → Lambda
api.yourapp.com/api/chat/*       → VPS
api.yourapp.com/socket.io/*      → VPS
```

Mobile and web clients need the **chat base URL** configured separately from the main API base URL (update `CHAT_MODULE_FRONTEND.md` when cutover happens).

---

## 11. Environment variables

### Lambda (add / keep)

| Variable | Purpose |
|----------|---------|
| `CHAT_SERVICE_BASE_URL` | e.g. `https://chat.yourapp.com` |
| `CHAT_SERVICE_INTERNAL_API_KEY` | Service-to-service auth |

Remove chat module imports; remove Socket.IO bootstrap from `server.js` on Lambda deploy.

### Chat Service (VPS)

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | Shared database |
| `JWT_SECRET` | Must match Lambda (user JWT validation) |
| `CHAT_SERVICE_INTERNAL_API_KEY` | Validate internal routes |
| `PORT` | e.g. `5001` |
| Firebase credentials | FCM (if push on VPS) |

---

## 12. Migration checklist

### Phase 1 — Bootstrap VPS

- [ ] New Express repo or folder with `src/modules/chat/` copied from monolith
- [ ] MongoDB connection, health check, JWT auth middleware
- [ ] Mount public `/api/chat` routes and Socket.IO
- [ ] Implement `/internal/chats/*` routes (wrap existing `chatProvisioning.service` logic)

### Phase 2 — Lambda integration

- [ ] Add HTTP client helper (`services/chat_service_client.js` or similar)
- [ ] `order_creation_service`: after order commit → `POST /internal/chats/order`
- [ ] `order_controller`: after sync → `POST /internal/chats/order/sync`
- [ ] `dispute_service`: after dispute commit → `POST /internal/chats/dispute`
- [ ] `dispute_service.updateDisputeStatus` → `POST /internal/chats/dispute-status`
- [ ] Remove `require('../src/modules/chat/...')` from Lambda

### Phase 3 — Cutover

- [ ] Point `chat.yourapp.com` (or gateway paths) to VPS
- [ ] Remove `/api/chat` and Socket.IO from Lambda `server.js`
- [ ] Update mobile/web chat base URL
- [ ] Verify idempotency under retries

### Phase 4 — Cleanup

- [ ] Delete unused chat paths from Lambda (keep `chat_id` on order/dispute models)
- [ ] Update Postman collection base URLs for chat folder
- [ ] Monitor VPS logs for provision failures and socket errors

---

## 13. Current code mapping (monolith → target)

| Current file | Target |
|--------------|--------|
| `src/modules/chat/**` | Move to Chat Service (VPS) |
| `server.js` chat routes + Socket.IO | VPS only |
| `services/order_creation_service.js` | Lambda → HTTP client |
| `controllers/order_controller.js` | Lambda → HTTP client |
| `services/dispute_service.js` | Lambda dispute logic + HTTP client for chat |
| `services/mobile/user/chat_dispute_service.js` | Split: dispute on Lambda; support chat route on VPS |
| `routes/dispute_routes.js` | Stays on Lambda |
| `models/dispute.js` | Stays on Lambda (VPS reads for provisioning) |

---

## 14. Failure and idempotency

| Scenario | Behavior |
|----------|----------|
| Duplicate `POST /internal/chats/order` | Return existing chat, `200`, `created: false` |
| Order commit succeeds, VPS provision fails | Log + retry queue; order exists without `chat_id` until retry |
| Dispute commit succeeds, chat provision fails | Roll back dispute or mark failed (match current product rules) |
| Lambda timeout calling VPS | Use async queue (SQS) for non-blocking provision if needed |
| Socket disconnect | Client uses `GET /api/chat/messages` REST fallback |

---

*Last updated: architecture target for Chat Service extraction. Implementation status: planning.*

---

## 15. Scaffolded repository

The standalone Chat Service lives at:

```
helper-git/help-pr-chat-service/
```

| Artifact | Location |
|----------|----------|
| Express + Socket.IO entry | `help-pr-chat-service/server.js` |
| Chat module | `help-pr-chat-service/src/modules/chat/` |
| Internal provision routes | `help-pr-chat-service/routes/internal/chats.routes.js` |
| Lambda HTTP client | `help-pr-backend-staging/services/chat_service_client.js` |
| Feature-flag bridge | `help-pr-backend-staging/services/chat_integration.js` |

**Enable remote chat provisioning in Lambda** (optional until cutover):

```env
CHAT_SERVICE_ENABLED=true
CHAT_SERVICE_BASE_URL=http://localhost:5001
CHAT_SERVICE_INTERNAL_API_KEY=<same-as-vps>
```

When `CHAT_SERVICE_ENABLED` is unset or `false`, Lambda continues using in-process `chatProvisioning.service` (legacy).

