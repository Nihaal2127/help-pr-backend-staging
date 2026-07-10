# Mobile push notifications — event catalog & implementation guide

This document lists **every business event** where push notifications fire (or are scheduled) for **customer mobile** (`user.type === 4`) and **partner mobile** (`user.type === 2`) apps.

Use it for:

- Backend implementation (wiring `domainHooks` into business logic)
- Mobile app notification handling (deep links, inbox UI)
- QA test plans per module

Related docs:

- **`docs/PUSH_NOTIFICATION_CLIENT_SPEC.md`** — client-facing instance list (internal); share **`docs/Mobile_Push_Notifications_Client_Spec.docx`**
- **`docs/CHAT_MODULE_FRONTEND.md`** §11 — chat message push (external Chat Service)
- **`docs/ORDER_MODULE_FRONTEND.md`** — order lifecycle
- **`docs/SUBSCRIPTION_CHANGE_FRONTEND.md`** — partner plan changes
- **`docs/REFUND_API.md`** — refund flows
- **`docs/APPOINTMENT_MODULE_FRONTEND.md`** — appointments

Postman: **`postman/Help-PR-Mobile-APIs.postman_collection.json`** — notification inbox under **User** and **Partner** folders.

---

## 1. Architecture overview

Push notifications are centralized in `src/modules/notifications/`. Business code does **not** call Firebase directly (except the gated dev test endpoint).

```text
Business action (order update, quote accept, cron reminder, …)
        │
        ▼
domainHooks.js / notificationReminder.service.js
        │
        ▼
notification.service.js  ──►  notify()
        │                         │
        │                         ├── Create in-app Notification record (MongoDB)
        │                         └── notificationPush.service.js
        │                                   │
        │                                   ├── is_update_allow (real-time)
        │                                   ├── is_reminder_allow (reminders)
        │                                   ├── user.device_token
        │                                   └── service/firebase/push_service.js (FCM)
        ▼
Recipient resolvers (orderRecipients, quoteRecipients, …)
```

| Layer | Path | Role |
|-------|------|------|
| Event templates | `src/modules/notifications/constants/notification_events.js` | Title/body per `eventKey` (36 keys) |
| Domain hooks | `src/modules/notifications/services/domainHooks.js` | `safeNotify*` wrappers for real-time events |
| Reminder runner | `src/modules/notifications/services/notificationReminder.service.js` | RM1–RM3 scheduled queries |
| Orchestrator | `src/modules/notifications/services/notification.service.js` | `notify()` — in-app record + push |
| Push gate | `src/modules/notifications/services/notificationPush.service.js` | Preference + device token checks |
| FCM sender | `service/firebase/push_service.js` | Firebase Admin SDK (`resources/adminsdk.json`) |
| Cron endpoint | `POST /api/notifications/cron/reminders` | EventBridge / external scheduler |
| Mobile inbox API | `src/modules/notifications/routes/mobileNotification.routes.js` | List / read / unread count |

**Preference model:** `models/notification_settings.js`

| Field | Default | Used for push? |
|-------|---------|----------------|
| `is_update_allow` | `true` | **Yes** — real-time business notifications |
| `is_reminder_allow` | `true` | **Yes** — RM1–RM3 reminder notifications |
| `is_sms_allow` | `true` | **No** — SMS stub only |

**Device token:** stored on `user.device_token`, set on mobile login/register (OTP, Google, Apple).

**Actor exclusion:** the user who triggered the event is removed from recipients in `notification.service.js`.

**Reminder ops env vars:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `NOTIFICATION_CRON_SECRET` | — | Required for cron HTTP endpoint |
| `SERVICE_REMINDER_LEAD_HOURS` | 24 | RM1 window |
| `QUOTE_PENDING_REMINDER_HOURS` | 48 | RM2 stale threshold |
| `SUBSCRIPTION_EXPIRING_REMINDER_DAYS` | 7 | RM3 expiry window |
| `ENABLE_NOTIFICATION_REMINDER_CRON` | — | Optional local `setInterval` (non-Lambda) |

---

## 2. Mobile notification inbox APIs

| App | Base path | Auth |
|-----|-----------|------|
| Customer | `{baseUrl}/api/mobile/user/notifications` | Bearer customer JWT |
| Partner | `{baseUrl}/api/mobile/partner/notifications` | Bearer partner JWT |
| Back-office | `{baseUrl}/api/notifications` | Bearer admin JWT |

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Paginated notification list |
| `GET` | `/unread-count` | Unread count |
| `PUT` | `/:id/read` | Mark one as read |
| `PUT` | `/read-all` | Mark all as read |

**Test endpoint:** `POST /api/notification/send` — requires admin JWT; disabled in production unless `ALLOW_NOTIFICATION_TEST=true`.

**Reminder cron:** `POST /api/notifications/cron/reminders` with header `x-cron-secret: <NOTIFICATION_CRON_SECRET>`.

---

## 3. Recipient rules

### Order events (`resolvers/orderRecipients.js`)

Customer, assigned employee, order-level partner, all service-line partners, franchise admins + employees (active, same `franchise_id`). Actor excluded.

### Quote events (`resolvers/quoteRecipients.js`)

Customer, partner, employee, `created_by_id`, franchise admins + employees. Actor excluded.

### Subscription events (`resolvers/subscriptionRecipients.js`)

Partner + franchise admins.

### Wallet events (`resolvers/walletRecipients.js`)

Partner only (`ledgerEntry.partner_id`).

### Targeted events (single recipient in hook)

| Event | Recipients |
|-------|------------|
| `QUOTE_ASSIGNED` | Assigned partner |
| `PARTNER_WORK_STARTED/COMPLETED` | Customer |
| `ORDER_PAYMENT_FAILED` | Customer |
| `ORDER_PAYMENT_COMPLETED` | Customer (when they pay) |
| `ORDER_PAYMENT_RECEIVED` | Partner(s) / stakeholders (not the payer) |
| `ORDER_REVIEW_RECEIVED` | Partner |
| `DISPUTE_RAISED` | Assigned employee |
| `DISPUTE_STATUS_CHANGED` | Customer |
| `PARTNER_VERIFICATION_*` | Partner |
| `TICKET_STATUS_CHANGED` | Ticket creator |

---

## 4. Unified event keys (36)

All defined in `notification_events.js`. Categories: `order`, `quote`, `subscription`, `wallet`, `ticket`, `chat`, `system`, `reminder`.

| Event key | Category | Push preference |
|-----------|----------|-----------------|
| `ORDER_CREATED` | order | update |
| `ORDER_STATUS_CHANGED` | order | update |
| `ORDER_CANCELLED` | order | update |
| `ORDER_SERVICE_STATUS_CHANGED` | order | update |
| `ORDER_SERVICE_ASSIGNED` | order | update |
| `ORDER_SERVICE_UNASSIGNED` | order | update |
| `ORDER_SERVICE_TIME_UPDATED` | order | update |
| `ORDER_SERVICE_CANCELLED` | order | update |
| `ORDER_PAYMENT_COMPLETED` | order | update |
| `ORDER_PAYMENT_RECEIVED` | order | update |
| `ORDER_PAYMENT_FAILED` | order | update |
| `ORDER_REFUND_PROCESSED` | order | update |
| `ORDER_ADDITIONAL_CHARGE_ADDED` | order | update |
| `ORDER_ADDITIONAL_CHARGE_UPDATED` | order | update |
| `ORDER_ADDITIONAL_CHARGE_REMOVED` | order | update |
| `PARTNER_WORK_STARTED` | order | update |
| `PARTNER_WORK_COMPLETED` | order | update |
| `ORDER_REVIEW_RECEIVED` | order | update |
| `APPOINTMENT_SCHEDULED` | order | update |
| `APPOINTMENT_STATUS_CHANGED` | order | update |
| `QUOTE_CREATED` | quote | update |
| `QUOTE_STATUS_CHANGED` | quote | update |
| `QUOTE_ASSIGNED` | quote | update |
| `SUBSCRIPTION_ASSIGNED` | subscription | update |
| `SUBSCRIPTION_STATUS_CHANGED` | subscription | update |
| `SUBSCRIPTION_PLAN_CHANGED` | subscription | update |
| `SUBSCRIPTION_PAYMENT_COMPLETED` | subscription | update |
| `WALLET_CREDIT` | wallet | update |
| `WALLET_DEBIT` | wallet | update |
| `DISPUTE_RAISED` | chat | update |
| `DISPUTE_STATUS_CHANGED` | chat | update |
| `PARTNER_VERIFICATION_APPROVED` | system | update |
| `PARTNER_VERIFICATION_REJECTED` | system | update |
| `TICKET_STATUS_CHANGED` | ticket | update |
| `SERVICE_REMINDER` | reminder | reminder |
| `QUOTE_ACTION_REMINDER` | reminder | reminder |
| `SUBSCRIPTION_EXPIRING_REMINDER` | reminder | reminder |

---

## 5. Event catalog by module

Legend: **✅ Live** · **❌ Gap**

### 5.1 Quotes

| # | Trigger | Status | Source |
|---|---------|--------|--------|
| Q1 | Quote created | ✅ | `quote_service.js`, `quote_controller.js` |
| Q2 | Partner assigned (`QUOTE_ASSIGNED`) | ✅ | Mobile customer + admin `quote_controller.js` |
| Q3–Q8 | Status changes / conversion | ✅ | Mobile + admin quote flows |

### 5.2 Orders

| # | Trigger | Status | Source |
|---|---------|--------|--------|
| O1–O3 | Create / status / cancel | ✅ | `order_creation_service.js`, `order_controller.js` |
| O4 | Order refunded (`ORDER_STATUS_CHANGED` → refunded) | ❌ | Refund sends `ORDER_REFUND_PROCESSED` only |
| O5–O9 | Service line events | ✅ | `order_controller.js` |
| O11–O12 | Partner start / complete work | ✅ | `order_work_service.js` |

### 5.2.1 Additional service charges

| # | Trigger | Status | Source |
|---|---------|--------|--------|
| AC1–AC3 | Charge created | ✅ | Partner mobile, admin, nested order create |
| AC4–AC5 | Charge updated / removed | ✅ | `order_additional_charge_service.js` |
| AC6 | Customer “payment due updated” copy | ❌ | Not implemented |

`actorUserId` is passed from admin and partner mobile create/update/delete APIs.

### 5.3 Payments

| # | Trigger | Status | Source |
|---|---------|--------|--------|
| P1–P6 | Payment completed paths | ✅ | CRUD, mobile, webhook, nested |
| P7 / P2 | Quote→order payment | ✅ | `quote_service.js` `convertCustomerQuoteToOrder` |
| P8 | Payment failed | ✅ | `orderOnlinePayment.service.js` |
| P9 / P4 | Refund processed | ✅ | `refund_service.js` |

### 5.4 Wallet

| # | Trigger | Status |
|---|---------|--------|
| W1–W4 | Credit/debit (order, payout, subscription) | ✅ |
| W5 / W3 | Refund wallet debit | ✅ |

### 5.5 Subscriptions

| # | Trigger | Status |
|---|---------|--------|
| S1–S2 | Admin assign / status | ✅ |
| S3–S4 | Self-service plan change / payment | ✅ |

### 5.6 Disputes & chat

| # | Trigger | Status |
|---|---------|--------|
| D1 | Dispute raised | ✅ |
| D2 | Dispute status changed | ✅ |
| D3 | Chat message | ✅ External (Chat Service) |

### 5.7 Tickets

| # | Trigger | Status |
|---|---------|--------|
| T1 | Ticket status changed | ✅ Unified `TICKET_STATUS_CHANGED` |
| T2 | Ticket created | ❌ |

### 5.8 Account

| # | Trigger | Status |
|---|---------|--------|
| A3–A4 | Partner verification approved/rejected | ✅ |

### 5.9 Appointments

| # | Trigger | Status |
|---|---------|--------|
| AP1 | Appointment created (manual + auto on order create) | ✅ |
| AP2 | Appointment status changed | ✅ |

### 5.10 Reviews

| # | Trigger | Status |
|---|---------|--------|
| R1 | Customer review submitted | ✅ |

### 5.11 Reminders (scheduled)

| # | Event | Trigger | Status |
|---|-------|---------|--------|
| RM1 | `SERVICE_REMINDER` | Upcoming appointment or order schedule | ✅ |
| RM2 | `QUOTE_ACTION_REMINDER` | Stale pending/accepted/new quotes | ✅ |
| RM3 | `SUBSCRIPTION_EXPIRING_REMINDER` | Active subscription expiring within N days | ✅ |

Run via `POST /api/notifications/cron/reminders`, `node scripts/run-notification-reminders.js`, or local cron when enabled.

---

## 6. Wiring map

| Hook / runner | Called from |
|---------------|-------------|
| `safeNotifyOrderCreated` | `order_creation_service.js` |
| `safeNotifyOrderStatusChanged` | `order_controller.js` |
| `safeNotifyOrderCancelled` | `order_controller.js` |
| `safeNotifyOrderService*` | `order_controller.js` |
| `safeNotifyOrderNestedResources` | `order_creation_service.js`, `order_controller.js` |
| `safeNotifyOrderPaymentReceived` | payment CRUD, mobile, Razorpay, quote conversion |
| `safeNotifyOrderPaymentFailed` | `orderOnlinePayment.service.js` |
| `safeNotifyOrderRefundProcessed` | `refund_service.js` |
| `safeNotifyOrderAdditionalCharge*` | `order_additional_charge_service.js` |
| `safeNotifyPartnerWorkStarted/Completed` | `order_work_service.js` |
| `safeNotifyOrderReviewReceived` | `order_review_service.js` |
| `safeNotifyQuoteCreated/StatusChanged` | mobile + admin quote flows |
| `safeNotifyQuoteAssigned` | mobile customer + admin `quote_controller.js` |
| `safeNotifySubscription*` | `partner_subscription_service.js`, `subscription_change_service.js` |
| `safeNotifyWalletTransaction` | wallet, payout, refund, subscription |
| `safeNotifyDispute*` | `dispute_service.js` |
| `safeNotifyPartnerVerificationUpdated` | `user_controller.js`, `partner_document_controller.js` |
| `safeNotifyAppointment*` | `appointment_service.js` (manual + auto create, status update) |
| `safeNotifyTicketStatusChanged` | `ticket_controller.js` |
| `runAllReminders` | cron endpoint, CLI script, optional `server.js` interval |

---

## 7. Implementation status

Phases 1–4 are **complete** for the agreed scope. Remaining gaps:

| Priority | Gap | Notes |
|----------|-----|-------|
| Low | O4 separate refunded status push | `ORDER_REFUND_PROCESSED` covers refund today |
| Low | AC6 payment-due copy | Optional customer-focused template |
| Low | T2 ticket created | Not in client spec |
| Ops | EventBridge cron | Schedule `POST /api/notifications/cron/reminders` in Lambda |
| Ops | `resources/adminsdk.json` | Required for FCM in production |

---

## 8. How to add a new notification

1. Add template in `notification_events.js`.
2. Add `safeNotify*` in `domainHooks.js` (or call `notify()` from reminder runner).
3. Wire `void safeNotify…()` after successful DB write.
4. Pass `actorUserId` and `dedupeKeyPrefix` where appropriate.
5. Use `pushPreference: 'reminder'` for scheduled reminders.
6. Update this doc and regenerate client `.docx`.

---

## 9. Mobile app integration

- Send `device_token` on every login.
- Expose toggles for `is_update_allow` and `is_reminder_allow`.
- Deep link using `data.event`, `data.entity_type`, `data.entity_id`, and `metadata`.
- Chat pushes use external Chat Service (`data.type = Chat`).

---

## 10. Delivery logging (debug)

Every `notify()` call writes one row per recipient to **`notification_delivery_log`** (unless `NOTIFICATION_DELIVERY_LOG_ENABLED=false`).

Server console lines are prefixed with `[notifications:delivery]`.

**Super admin / staff API:** `GET /api/notifications/delivery-logs`

| Query param | Description |
|-------------|-------------|
| `event` | e.g. `ORDER_CREATED`, `QUOTE_STATUS_CHANGED` |
| `recipient_user_id` | Filter by user |
| `entity_id` | Order/quote id |
| `entity_type` | `order`, `quote`, … |
| `push_sent` | `true` / `false` |
| `push_skip_reason` | e.g. `no_device_token`, `firebase_not_configured` |
| `from_date` / `to_date` | UTC date range on `created_at` |
| `page` / `limit` | Pagination |

### Common `push_skip_reason` values

| Reason | Meaning |
|--------|---------|
| `no_device_token` | User has no FCM token saved (login without `device_token`) |
| `firebase_not_configured` | `adminsdk-customer.json` / `adminsdk-partner.json` missing on server |
| `backoffice_user_no_mobile_push` | Franchise admin/employee — in-app only |
| `settings_disabled` | User turned off update notifications |
| `firebase_send_failed` | FCM rejected token (wrong project, expired token, etc.) |
| `dedupe_skipped` | Duplicate event suppressed |
| `push_disabled_for_hook` | Backoffice in-app-only hooks |

---

## 11. Document history

| Date | Change |
|------|--------|
| 2026-07-07 | Initial catalog |
| 2026-07-08 | Phases 1–4 complete; 36 event keys; reminders + preference wiring documented |
