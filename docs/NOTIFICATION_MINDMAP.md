# HelpPR notifications — complete flow mind map

Same style as the payment and chat maps: one root, then every path.

## Root: HelpPR notifications

```text
                   HELPPR NOTIFICATIONS
                            │
     ┌──────────────────────┼──────────────────────┐
     │                      │                      │
 IN-APP INBOX            MOBILE PUSH            CHAT PUSH
 (MongoDB row)           (FCM, this API)        (FCM, Chat VPS)
     │                      │                      │
  every business         customer + partner      new chat message
  event + reminders      apps only               if recipient offline
```

This backend **never** calls Firebase from controllers. After a DB write it calls `safeNotify*`. Chat message push is **not** this module — that lives on the Chat VPS.

Two hosts, two jobs:

```text
lambdaApiUrl     →  business notify() + inbox APIs + reminder cron
chatServiceUrl   →  Socket.IO + FCM for chat messages
```

---

## 1. Two products (who owns what)

```text
NOTIFICATION SYSTEM
├── A. THIS BACKEND (Lambda)
│     owns: in-app inbox, business FCM, reminders, delivery logs
│     never: chat_messages FCM
│     talks to VPS via: (VPS calls US)
│       POST /api/notifications/webhooks/chat-message
│       header x-webhook-secret
│
└── B. CHAT SERVICE (VPS)
      owns: live room + chat FCM
      if recipient has no socket → FCM data.type = Chat
      optionally pings Lambda so franchise staff get an in-app copy
```

---

## 2. Three kinds of “notification”

```text
KIND
├── update     real-time business event
│              gated by notification_settings.is_update_allow
│              events: ORDER_*, QUOTE_*, PAYMENT_*, WALLET_*, …
│
├── reminder   scheduled (cron)
│              gated by notification_settings.is_reminder_allow
│              events: SERVICE_REMINDER, QUOTE_*_REMINDER, SUBSCRIPTION_EXPIRING
│
└── chat       not this module’s FCM
               VPS push for messages
               Lambda only stores BACKOFFICE_CHAT_MESSAGE_RECEIVED (in-app, no push)
```

`is_sms_allow` exists on settings. It is **not** used.

---

## 3. Mind map of the core strip (`notify()`)

This is the only write path. Every hook ends here.

```text
YOU                         THIS BACKEND                     RECIPIENT
 │                              │                                 │
 │  1. Save order/quote/…       │                                 │
 │     (Mongo committed)        │                                 │
 │                              │                                 │
 │  2. void safeNotify*()  ────►│  domainHooks / backofficeHooks  │
 │     never throws             │                                 │
 │                              │                                 │
 │                              │  3. Resolver: who should hear   │
 │                              │     (customer, partner, admin…) │
 │                              │                                 │
 │                              │  4. Drop actorUserId            │
 │                              │     (doer does not get a ping)  │
 │                              │                                 │
 │                              │  5. Dedupe                      │
 │                              │     dedupe_key unique per user  │
 │                              │                                 │
 │                              │  6. INSERT notification row ───►│  inbox
 │                              │                                 │
 │                              │  7. Push gates                  │
 │                              │     settings → role → token     │
 │                              │                                 │
 │                              │  8. FCM ───────────────────────►│  tray
 │                              │     customer SDK or partner SDK │
 │                              │                                 │
 │                              │  9. notification_delivery_log   │
 │                              │     one row per device attempt  │
```

If step 8 is skipped, the inbox row **still exists**. Push failure never rolls back the business write.

---

## 4. Delivery decision tree (step 7–8)

```text
sendPushForNotification(userId)
        │
        ├── skipPush: true (backoffice hooks)
        │     → in-app only   reason: push_disabled_for_hook
        │
        ├── no settings row                → treat as allowed
        ├── is_update_allow === false      → skip   settings_disabled
        ├── reminder + is_reminder_allow false → skip   reminder_settings_disabled
        │
        ├── user.type in {1,3,5,6}
        │     Franchise Admin / Employee / Super Admin / Staff
        │     → skip FCM   backoffice_user_no_mobile_push
        │     → inbox still created
        │
        ├── user.type === 4  → Firebase customer app  (adminsdk-customer.json)
        ├── user.type === 2  → Firebase partner app   (adminsdk-partner.json)
        ├── other type       → skip   unsupported_user_type
        │
        ├── SDK file missing → skip   firebase_not_configured
        ├── no user_device_token rows → skip   no_device_token
        │
        └── for each device token
              FCM send
              stale token → delete from user_device_token
              duplicate token in same batch → skip
```

**Who can get a tray notification from this backend**

| Type | Role | Inbox | FCM from Lambda |
|------|------|-------|-----------------|
| 4 | Customer | yes | yes |
| 2 | Partner | yes | yes |
| 1 / 3 / 5 / 6 | Back-office | yes | **no** |

Device tokens are registered on mobile login (`device_token` + `user_device_token`). Multi-device is supported. Latest token is mirrored onto `user.device_token`.

---

## 5. Who hears a business event (resolvers)

```text
RECIPIENTS
├── orderRecipients
│     customer (order.user_id)
│     order.partner_id
│     partners on service lines
│     assigned employee
│     franchise admins (same franchise_id)
│
├── quoteRecipients
│     customer
│     created_by
│     assigned employee
│     franchise admins
│     partner  ONLY if quote is released (pending+)
│              not on a brand-new unassigned quote
│
├── subscriptionRecipients
│     partner + franchise admins
│
├── walletRecipients
│     partner only
│
└── backofficeRecipients
      Super Admin + Staff
      and/or franchise Admin + Employee
```

Then `notify()` always removes `actorUserId`.

---

## 6. Mind map of every notification path

```text
NOTIFICATIONS
│
├── 6.1 QUOTES
│     Q1  created
│           POST /api/quote/create  OR  mobile customer create
│           → QUOTE_CREATED
│           → also BACKOFFICE_QUOTE_CREATED (in-app, no push)
│
│     Q2  partner assigned (new → pending)
│           → QUOTE_ASSIGNED          partner only
│           → QUOTE_STATUS_CHANGED    other stakeholders
│
│     Q3–Q8  accept / reject / cancel / convert to order
│           → QUOTE_STATUS_CHANGED
│           → also BACKOFFICE_QUOTE_STATUS_CHANGED
│
├── 6.2 ORDERS
│     O1  order saved
│           quote success OR POST /api/order/create
│           → ORDER_CREATED
│           → also BACKOFFICE_ORDER_CREATED
│
│     O2  order_status changes
│           → ORDER_STATUS_CHANGED
│           → also BACKOFFICE_ORDER_STATUS_CHANGED
│
│     O3  cancelled
│           → ORDER_CANCELLED
│
│     O5–O9  service line
│           assigned     → ORDER_SERVICE_ASSIGNED      (that partner)
│           unassigned   → ORDER_SERVICE_UNASSIGNED    (previous partner)
│           status       → ORDER_SERVICE_STATUS_CHANGED
│           time         → ORDER_SERVICE_TIME_UPDATED  (line partner)
│           cancelled    → ORDER_SERVICE_CANCELLED
│
│     O11 partner Start work  → PARTNER_WORK_STARTED   (customer)
│     O12 partner Complete    → PARTNER_WORK_COMPLETED (customer)
│
├── 6.3 ADDITIONAL CHARGES
│     add / update / remove
│           → ORDER_ADDITIONAL_CHARGE_ADDED
│           → ORDER_ADDITIONAL_CHARGE_UPDATED
│           → ORDER_ADDITIONAL_CHARGE_REMOVED
│
├── 6.4 PAYMENTS
│     customer pay completed (offline create, mobile, Razorpay webhook)
│           → ORDER_PAYMENT_COMPLETED     customer  “Payment successful”
│           → ORDER_PAYMENT_RECEIVED      partners/staff  “Payment received”
│           → BACKOFFICE_CUSTOMER_PAYMENT_RECEIVED  (in-app)
│
│     partner pay recorded
│           → ORDER_PAYMENT_RECEIVED
│           → BACKOFFICE_PARTNER_PAYMENT_RECEIVED
│
│     Razorpay link fails
│           → ORDER_PAYMENT_FAILED        customer
│
│     refund
│           → ORDER_REFUND_PROCESSED
│           (no separate “status → refunded” push)
│
├── 6.5 WALLET (partner)
│     credit / debit (order earning, payout, subscription, refund clawback)
│           → WALLET_CREDIT  or  WALLET_DEBIT
│
├── 6.6 SUBSCRIPTIONS (partner)
│     admin assign     → SUBSCRIPTION_ASSIGNED
│     status change    → SUBSCRIPTION_STATUS_CHANGED
│     self-service     → SUBSCRIPTION_PLAN_CHANGED
│     online paid      → SUBSCRIPTION_PAYMENT_COMPLETED
│     + BACKOFFICE_SUBSCRIPTION_CHANGED
│
├── 6.7 DISPUTES  (this API — not chat messages)
│     customer raises  → DISPUTE_RAISED           assigned employee
│     status update    → DISPUTE_STATUS_CHANGED   customer
│
├── 6.8 TICKETS
│     status change    → TICKET_STATUS_CHANGED    ticket creator
│     ticket created   → (not wired)
│
├── 6.9 ACCOUNT / POSTS
│     partner verified / rejected
│           → PARTNER_VERIFICATION_APPROVED | REJECTED
│     post approved / rejected / hidden / removed
│           → PARTNER_POST_*
│
├── 6.10 APPOINTMENTS
│     created (manual or auto with order)
│           → APPOINTMENT_SCHEDULED
│     status change
│           → APPOINTMENT_STATUS_CHANGED
│
├── 6.11 REVIEWS
│     customer rates order
│           → ORDER_REVIEW_RECEIVED     partner
│
├── 6.12 REMINDERS  (cron, not a user action)
│     RM1  service soon (~24h)              SERVICE_REMINDER
│            customer + partner on appointment/order
│     RM2  quote sitting too long (~48h)    QUOTE_ACTION_REMINDER
│            pending  → partner
│            accepted → customer
│            new      → Super Admin/Staff + franchise staff
│     RM3  plan expiring (~7 days)          SUBSCRIPTION_EXPIRING_REMINDER
│            partner
│     RM4  1-hour quote window              QUOTE_DEADLINE_REMINDER
│            20 / 10 / 5 / 2 minutes left
│            pending  → partner  “accept or reject”
│            accepted → customer “convert to order”
│
└── 6.13 BACK-OFFICE ONLY  (skipPush: true — web inbox)
      CATEGORY_REQUEST_SUBMITTED      Super Admin / Staff
      SERVICE_REQUEST_SUBMITTED       Super Admin / Staff
      CATALOG_REQUEST_REVIEWED        requester + franchise staff
      PARTNER_PENDING_VERIFICATION    Super Admin/Staff + franchise
      EMPLOYEE_ADDED
      EXPENSE_CREATED
      PARTNER_POST_PENDING_REVIEW
      BACKOFFICE_QUOTE_* / ORDER_* / PAYMENT_* / SUBSCRIPTION_*
      BACKOFFICE_CHAT_MESSAGE_RECEIVED   from VPS webhook
      partner/customer account deleted
```

---

## 7. Quote → order → cash (notifications on that path)

```text
                    ┌──────────────┐
                    │ Create quote │
                    │ QUOTE_CREATED│
                    └──────┬───────┘
                           │ assign partner
              ┌────────────▼────────────┐
              │ QUOTE_ASSIGNED          │
              │ (+ status → pending)    │
              └────────────┬────────────┘
                           │ accept
              ┌────────────▼────────────┐
              │ QUOTE_STATUS_CHANGED    │
              └────────────┬────────────┘
                           │ success / convert
              ┌────────────▼────────────┐
              │ ORDER_CREATED           │
              │ APPOINTMENT_SCHEDULED   │
              └────────────┬────────────┘
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
  PAYMENT_COMPLETED   CHARGE_ADDED    PARTNER_WORK_*
  PAYMENT_RECEIVED                    then COMPLETED
         │
         ▼
  WALLET_CREDIT (partner earning)
  ORDER_REFUND_PROCESSED (if needed)
```

While the quote is waiting, cron can inject RM2 / RM4 without anyone clicking.

---

## 8. Chat vs this module (do not mix them)

```text
NEW CHAT MESSAGE
        │
        ├── recipient online (socket in room)
        │     VPS emit receive_message     ← not a Notification row
        │
        ├── recipient offline
        │     VPS FCM   data.type = Chat   ← not this Firebase sender
        │
        └── franchise staff copy (optional)
              VPS → POST /api/notifications/webhooks/chat-message
                    header x-webhook-secret
                    → BACKOFFICE_CHAT_MESSAGE_RECEIVED
                    → franchise Admin + Employee inbox
                    → NO mobile push
```

Dispute **record** events (`DISPUTE_RAISED`) are this backend. Dispute **chat bubbles** are the VPS path above.

---

## 9. Inbox APIs (how the user sees it)

```text
INBOX
├── Customer app     GET/PUT  /api/mobile/user/notifications
├── Partner app      GET/PUT  /api/mobile/partner/notifications
└── Back-office web  GET/PUT  /api/notifications

      GET  /                 paginated list  (filter: category, event, is_read)
      GET  /unread-count
      PUT  /:id/read
      PUT  /read-all
```

Each row:

```text
title, body
category     order | quote | subscription | wallet | ticket | chat | system | reminder | admin
event        ORDER_CREATED, …
entity       { type, id }     ← deep link
metadata     order_id, quote_id, …
is_read
```

FCM data for the same event:

```text
data.event
data.type            same as category  (Chat for VPS chat push)
data.entity_type
data.entity_id
data.notification_id
click_action         FLUTTER_NOTIFICATION_CLICK
```

---

## 10. Settings, cron, debug

```text
PREFERENCES
  GET/PUT /api/notification_settings/…
    is_update_allow      real-time FCM
    is_reminder_allow    RM1–RM4 FCM
    is_sms_allow         unused

CRON
  POST /api/notifications/cron/reminders
    header x-cron-secret: NOTIFICATION_CRON_SECRET
    EventBridge: rate(1 minute)  so RM4’s 2-minute bucket can hit
  or local: ENABLE_NOTIFICATION_REMINDER_CRON=true

DEBUG
  GET /api/notifications/delivery-logs     Super Admin / Staff
  POST /api/notification/send              test FCM (off in production)
  GET  /api/notification/status            Firebase SDK ready?
```

Common `push_skip_reason` values:

```text
no_device_token
firebase_not_configured
backoffice_user_no_mobile_push
settings_disabled / reminder_settings_disabled
firebase_send_failed
dedupe_skipped
push_disabled_for_hook
```

---

## 11. Folders (where the tree lives)

```text
src/modules/notifications/
├── constants/notification_events.js     title/body templates
├── services/domainHooks.js              business safeNotify*
├── services/backofficeHooks.js          skipPush: true
├── services/notificationReminder.service.js   RM1–RM4
├── services/notification.service.js     notify() + inbox CRUD
├── services/notificationPush.service.js FCM gates
├── resolvers/*                          who to notify
└── routes/                              web + mobile + cron + chat webhook

service/firebase/push_service.js         two Firebase Admin apps
services/device_token_service.js         register / prune tokens
models/notification.js
models/notification_settings.js
models/notification_delivery_log.js
models/user_device_token.js
```

---

**One-line model:** a committed business write fans out to inbox rows for everyone involved except the actor; FCM is an extra step that only customer and partner devices can receive; chat bubbles are a different product on the VPS.
