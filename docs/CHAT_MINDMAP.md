# HelpPR chats — complete flow mind map

Same style as the payment map: one root, then every path.

## Root: HelpPR chat

```text
                      HELPPR CHATS
                           │
     ┌─────────────────────┼─────────────────────┐
     │                     │                     │
CREATE THREAD          TALK LIVE             SIDE EFFECTS
(provision)            (Socket.IO)           (push / close)
     │                     │                     │
  Lambda                Chat VPS              Chat VPS
  asks VPS              owns rooms            + optional
  after order/          + messages            Lambda notify
  dispute save
```

Only the Chat Service is the chat product. This backend never stores messages. It only says “open a room for this order/dispute.”

Two hosts, one JWT (`JWT_SECRET` is shared):

```text
lambdaApiUrl     →  orders, disputes, login, file upload
chatServiceUrl   →  inbox, messages, Socket.IO, transfer, close
```

---

## 1. Two servers (who owns what)

```text
CHAT SYSTEM
├── A. THIS BACKEND (Lambda)
│     owns: order, dispute record, users, S3 upload
│     never: /api/chat, Socket.IO, chat collections
│     talks to VPS via:
│       POST /internal/chats/*   header X-Internal-Api-Key
│
└── B. CHAT SERVICE (VPS)          ★ real chat
      owns: rooms, messages, sockets, FCM
      public:  /api/chat/*  + Socket.IO
      internal: /internal/chats/*  (Lambda only)
```

Enable switch on Lambda:

```text
CHAT_SERVICE_ENABLED=true
CHAT_SERVICE_BASE_URL=http://13.201.79.72:5001
CHAT_SERVICE_INTERNAL_API_KEY=shared-secret
```

If those are off: order still saves, chat is simply missing.

---

## 2. Three kinds of “chat”

```text
CHAT.type
├── order     GROUP     customer + partner + employee + franchise admin
│             created automatically when order is saved
│             lives on order.chat_id
│
├── dispute   1:1       customer + handler (assignedTo)
│             created when customer raises dispute
│             lives on dispute.chat_id   ← NOT order.chat_id
│
└── support   1:1       customer + auto-assigned employee
              created when customer/staff starts Help
              no order required
```

```text
SAME ORDER can have TWO threads
   order.chat_id      → group job chat
   dispute.chat_id    → separate complaint chat
```

---

## 3. Mind map of every chat path

```text
CHATS
│
├── 3.1 ORDER GROUP CHAT          (automatic)
│     Order saved (POST /api/order/create  OR  quote → success)
│           │
│           ├─ 1. Order committed in MongoDB          ← must exist first
│           ├─ 2. Lambda fire-and-forget
│           │      POST /internal/chats/order { orderId }
│           ├─ 3. VPS reads order → creates group chat
│           │      participants: user_id, partner_id, employee_id, franchise.admin_id
│           │      missing roles OK — chat still created
│           ├─ 4. VPS returns chatId
│           └─ 5. Lambda sets order.chat_id
│
│     Later: employee/partner assigned
│           POST /internal/chats/order/sync   (from order update)
│           → participants refreshed, same chatId
│
│     If VPS is down: order exists without chat_id
│     Retry: scripts/backfill-order-chats.js
│
├── 3.2 DISPUTE CHAT              (customer only)
│     POST {lambda}/api/mobile/user/disputes
│           │
│           ├─ gates (ALL must pass)
│           │     order belongs to this customer
│           │     order_status = completed
│           │     order has employee_id
│           │     no open/in_review dispute already
│           │
│           ├─ 1. Create dispute record (status: open)
│           ├─ 2. POST /internal/chats/dispute
│           ├─ 3. VPS creates 1:1 chat
│           │      participants: customer + employee
│           │      assignedTo: employee
│           │      context: { orderId, disputeId }
│           │      system message: reason / description
│           ├─ 4. If VPS fails → DELETE dispute (rollback)
│           └─ 5. Save dispute.chat_id → return to app
│
│     Admin never creates this. They open chat_id from GET /api/dispute/get/:id
│
├── 3.3 SUPPORT CHAT              (Help / general)
│     Customer:
│       POST {chatService}/api/mobile/user/chats/support
│       (or Lambda proxy of the same path)
│           │
│           ├─ resume open support chat if one exists
│           └─ else auto-assign employee with fewest open support chats
│                 (same franchise, is_active, chat !== false)
│
│     Back-office:
│       POST {chatService}/api/chat/support
│       { customer_id, employee_id?, initial_message }
│       Super admin / staff CANNOT start this (read-only)
│
├── 3.4 LIVE MESSAGING            ★ day-to-day
│     Socket.IO on Chat Service (see §4)
│
├── 3.5 TRANSFER HANDLER
│     POST {chatService}/api/chat/:id/transfer
│     or socket transfer_chat
│           │
│           ├─ support / dispute → FULL HANDOFF
│           │     customer stays
│           │     old handler removed from participants
│           │     new handler added, assignedTo updated
│           │     dispute.employee_id updated too
│           │
│           └─ order → only assignedTo changes
│                 group members stay
│
├── 3.6 CLOSE CHAT
│     PATCH {chatService}/api/chat/:id/status  { status: "closed" }
│           │
│           ├─ dispute: ALSO auto-closed when Lambda
│           │     PUT /api/dispute/update/:id  → resolved | closed
│           │     then POST /internal/chats/dispute-status
│           │
│           ├─ order:  never auto-closed when job completes
│           └─ support: never auto-closed
│
└── 3.7 ATTACHMENTS
      Upload on Lambda, URL sent on VPS (see §6)
```

---

## 4. Live messaging — one strip (the core)

```text
YOU                         CHAT VPS                      OTHER PEOPLE
 │                              │                              │
 │  1. Connect Socket.IO        │                              │
 │     JWT in auth.token        │                              │
 │                              │                              │
 │  2. GET /api/chat (inbox) ──►│                              │
 │  3. GET /messages (once) ───►│  history                    │
 │  4. emit join_chat ─────────►│  socket.join(chatId)         │
 │                              │                              │
 │  5. emit send_message ──────►│                              │
 │     + clientMessageId        │  save chat_messages          │
 │                              │  update chats.lastMessage    │
 │  6. message_sent  ◄──────────│  (you only — ack)            │
 │                              │                              │
 │                              │── receive_message ──────────►│  others in room
 │                              │                              │
 │                              │── FCM ── if they have ──────►│  no socket
 │                              │     no active connection     │
 │                              │                              │
 │  Callback / REST poll does NOT exist.                       │
 │  GET /messages is history, not a live feed.                 │
```

Why pending-style `clientMessageId`? The bubble shows immediately (`sending`). VPS ack is the receipt. Same idea as Razorpay pending → webhook.

REST fallback (socket down only):

```text
POST /api/chat/messages  →  same save + FCM + emit receive_message
```

Socket events:

```text
CLIENT → VPS                    VPS → CLIENT
join_chat / leave_chat          connection_status
send_message                    message_sent (you)
read_messages                   receive_message (others)
typing_start / typing_stop      typing_start / typing_stop
edit_message / delete_message   message_edited / message_deleted
message_delivered               message_delivered
transfer_chat                   chat_assigned, chat_updated
add_member / remove_member      member_added / member_removed
                                presence_updated
                                chat_error
                                messages_read
```

---

## 5. Inbox and who sees what

```text
GET {chatService}/api/chat
        │
        ├── Customer          chats they are in
        ├── Employee          chats they are assignedTo OR participant
        ├── Franchise admin   all chats in their franchise
        └── Super admin / Staff   ALL chats, paginated, READ-ONLY
```

Write rules (support + dispute):

```text
SEND / TYPE / ATTACH
├── Customer                          yes
├── assignedTo === me                 yes
├── Franchise admin (not handler)     NO   403 CHAT_READ_ONLY
├── Previous handler after transfer   NO
└── Super admin / Staff               NO
```

Order group chat is looser: participants and franchise-scoped roles can still message.

UI rule: show the compose box only if `assignedTo === currentUserId` or caller is the customer.

---

## 6. Attachments

Chat VPS stores a URL only. It does not accept multipart.

```text
FILE
  │
  ▼
POST {lambda}/api/document_upload/files
  type: 7          ← must be 7 (chat_attachment/)
  field: files
  JPEG/PNG/WebP/PDF, max 10 MB
  │
  ▼
records[0] = https://cdn.../chat_attachment/uuid_file.pdf
  │
  ▼
send_message on VPS
  type: image | file
  fileUrl: that exact URL
```

Wrong `type` (e.g. 2 = category) puts the file in the wrong S3 folder → broken links.

---

## 7. Status mind map

```text
chat.status
├── open       live thread (inbox default filter)
├── closed     finished; history still readable
└── pending    allowed, rarely used
```

```text
dispute.status          chat side effect
├── open                chat open
├── in_review           chat stays open + system message
├── resolved            chat CLOSED + system message
└── closed              chat CLOSED + system message
```

```text
message.deliveryStatus
├── sent
├── delivered     deliveredTo[]
└── read          readBy[]
```

Order completion does not close the order chat.

---

## 8. Internal vs public vs callback

```text
AFTER SOMETHING BUSINESS HAPPENS
        │
        ├── Lambda → VPS (service key, not user JWT)
        │     POST /internal/chats/order
        │     POST /internal/chats/order/sync
        │     POST /internal/chats/dispute
        │     POST /internal/chats/dispute-status
        │
        ├── Client → VPS (user JWT)
        │     GET  /api/chat
        │     GET  /api/chat/messages
        │     POST /api/chat/messages          fallback only
        │     POST /api/chat/:id/transfer
        │     PATCH /api/chat/:id/status
        │     Socket.IO
        │
        └── VPS → Lambda (optional)
              POST /api/notifications/webhooks/chat-message
              header x-webhook-secret
              → in-app notify franchise staff
```

Clients never call `/internal/chats/*`. That is Lambda → VPS only.

---

## 9. Collections (where chat lives)

```text
MongoDB (shared)
│
├── THIS BACKEND WRITES
│     orders.chat_id
│     disputes.chat_id
│     users (JWT, device_token, chat flag)
│     S3 via document_upload
│
└── CHAT SERVICE WRITES (Lambda must not)
      chats
      chat_messages
      chat_read_trackings
```

On every chat record the client cares about:

```text
assignedTo / assignedToUser     handler name + avatar
participants / participantUsers everyone in the thread
roles                           { userId, role }
unreadCount                     inbox badge
context                         { orderId, disputeId } when relevant
```

---

## 10. End-to-end stories

### A. One job (order group chat)

```text
Staff creates order / quote → success
        │
        ▼
ORDER O1017 saved
        │  POST /internal/chats/order
        ▼
GROUP CHAT  (customer, partner, employee, admin)
        │
Customer opens order → join_chat(order.chat_id)
        │
All four can message in the group
        │
Employee assigned later → /order/sync adds them
        │
Order completed → chat STAYS OPEN
        │
Admin may PATCH status closed when conversation is done
```

### B. Complaint after the job (dispute)

```text
Order completed, has employee
        │
Customer POST /disputes { reason }
        │
DISPUTE record + new 1:1 chat
        │
Customer ↔ employee only send
Admin can read / transfer / resolve
        │
Admin PUT dispute status = resolved
        │  POST /internal/chats/dispute-status
        ▼
Chat closed + system message
```

### C. Help / support

```text
Customer POST /chats/support  “I need help”
        │
Resume open thread  OR  assign least-busy employee
        │
1:1 customer ↔ handler
        │
Admin transfers to another employee
        │  full handoff, same chatId, old handler read-only
        ▼
Admin PATCH closed when done
```

---

## 11. Client flow (app / web)

```text
LOGIN (Lambda) → JWT
        │
APP OPEN
  connect Socket.IO → chatServiceUrl
  GET /api/chat                inbox once
        │
OPEN THREAD
  GET /messages?chatId=        history once
  join_chat
  read_messages                clear unread
        │
SEND
  bubble status=sending + clientMessageId
  emit send_message
        │
        ├─ message_sent   → status=sent, real _id
        ├─ chat_error     → status=failed, Retry
        └─ socket down    → POST /messages
        │
SCROLL UP     GET /messages?before=
RECONNECT     join_chat again + GET /messages?after=
BACKGROUND    FCM tap → open chat_id
```

Do not poll `GET /messages`. That is what Socket.IO is for.

---

## 12. One-page map

```text
     ┌─────────────────────────────────────┐
     │         CUSTOMER / PARTNER / STAFF   │
     │   Socket.IO + JWT  OR  REST fallback │
     └──────────────────┬──────────────────┘
                        │ talk
                        ▼
     ┌─────────────────────────────────────┐
     │         CHAT SERVICE (VPS)           │
     │  rooms, messages, transfer, FCM      │
     └──────────────────┬──────────────────┘
                        │
     ┌──────────────────┼──────────────────┐
     ▼                  ▼                  ▼
chats            chat_messages      chat_read_trackings
     │
     │  chatId stored back on
     ▼
ORDER.chat_id          DISPUTE.chat_id
(group job)            (1:1 complaint)
     ▲
     │  “please open a room”
     │
     ┌─────────────────────────────────────┐
     │     THIS BACKEND (Lambda)            │
     │  save order / dispute FIRST          │
     │  then POST /internal/chats/*         │
     │  upload files type=7                 │
     └─────────────────────────────────────┘
```

---

## Rules that keep the map honest

1. Save the business row first, then provision chat. Never the other way around.
2. Dispute chat fail → dispute is deleted. Order chat fail → order stays, `chat_id` empty.
3. Two URLs. Calling Lambda for `/api/chat` will 404.
4. Support/dispute compose only for customer + current `assignedTo`.
5. Transfer does not create a new thread. Same `chatId`, history stays.
6. Callback page does not exist for chat. Socket ack / REST 201 is the receipt.
