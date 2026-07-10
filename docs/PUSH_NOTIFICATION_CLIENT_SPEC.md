# Push notification client specification



> **Internal use only.** For client sharing, use **`docs/Mobile_Push_Notifications_Client_Spec.docx`** (regenerate via `python scripts/generate_push_notification_client_docx.py`).



Client-facing list of **every push notification instance** for the **Customer mobile app** and **Partner mobile app**: who receives it, and the **title + body** template.



For backend architecture and implementation status, see **`docs/MOBILE_PUSH_NOTIFICATIONS.md`**.



---



## 1. User types



| App / role | Code | Receives push? |

|------------|------|----------------|

| **Customer mobile app** | `user.type = 4` | Yes — primary audience |

| **Partner mobile app** | `user.type = 2` | Yes — primary audience |

| Franchise admin | `type = 1` | In-app + push if logged in with device token |

| Employee | `type = 3` | Same as above (disputes, order/quote events) |



**Rules applied to all rows below:**



- The person who **performed the action** does not receive the notification.

- Real-time push requires `notification_settings.is_update_allow` and `device_token`.

- Reminder push (RM1–RM3) requires `notification_settings.is_reminder_allow` and `device_token`.

- Placeholders in templates are replaced at send time (see §2).



---



## 2. Template placeholders



| Placeholder | Example | Description |

|-------------|---------|-------------|

| `{order_id}` | `ORD-1024` | Order `unique_id` |

| `{quote_id}` | `QT-558` | Quote `quote_sequence_id` |

| `{service_name}` | `AC Repair` | Service line name |

| `{amount}` | `1500.00` | Amount (2 decimal places) |

| `{charge_label}` | `Extra parts` | Additional charge label (optional; shown as ` (label)`) |

| `{total_amount}` | `1770.00` | Charge total incl. tax & commission |

| `{new_due_amount}` | `2500.00` | Updated `customer_due_amount` *(not implemented)* |

| `{payer_type}` | `customer` / `partner` | Who paid (optional) |

| `{status}` | `accepted`, `In-Progress`, `completed` | New status value |

| `{plan_name}` | `Gold Plan` | Subscription plan name |

| `{description}` | `Order payment credit` | Wallet entry description (optional) |

| `{dispute_id}` | `DSP-12` | Dispute `unique_id` |

| `{ticket_id}` | `TKT-88` | Ticket `unique_id` |

| `{sender_name}` | `John` | Chat sender display name |

| `{message_preview}` | `Hello, when will you arrive?` | Chat message text or attachment summary |



---



## 3. Master notification table (all instances)



**Status:** **Live** = implemented · **Planned** = not yet wired



| # | Module | Instance (when it fires) | Customer app | Partner app | Title | Body template | Status |

|---|--------|--------------------------|:------------:|:-----------:|-------|---------------|--------|

| **Quotes** |

| Q1 | Quote | Customer or admin creates a new quote | ✅ If not creator | ✅ If assigned on quote | New quote | Quote #{quote_id} has been created. | Live |

| Q2 | Quote | Customer or admin assigns a partner (`new` → `pending`) | ❌ | ✅ Assigned partner | New quote request | Quote #{quote_id} has been assigned to you. Please review. | Live |

| Q3 | Quote | Partner accepts quote (`pending` → `accepted`) | ✅ Customer | ✅ Other stakeholders | Quote status update | Quote #{quote_id} status changed to accepted. | Live |

| Q4 | Quote | Partner rejects quote (`pending` → `failed`) | ✅ Customer | ✅ Other stakeholders | Quote status update | Quote #{quote_id} status changed to failed. | Live |

| Q5 | Quote | Customer cancels quote | ❌ | ✅ Partner + staff | Quote status update | Quote #{quote_id} status changed to failed. | Live |

| Q6 | Quote | Admin updates quote status | ✅ If on quote | ✅ If on quote | Quote status update | Quote #{quote_id} status changed to {status}. | Live |

| Q7 | Quote | Quote converted to order (admin: `accepted` → `success`) | ✅ Customer | ✅ Partner | Quote status update | Quote #{quote_id} status changed to success. | Live |

| Q8 | Quote | Customer converts quote to order (mobile) | ✅ Customer | ✅ Partner | Quote status update | Quote #{quote_id} status changed to success. | Live |

| **Orders** |

| O1 | Order | New order created | ✅ Customer | ✅ Assigned partner(s) | New order | Order #{order_id} has been created. | Live |

| O2 | Order | Order status changed (e.g. in-progress → completed) | ✅ Customer | ✅ Partner(s) | Order status update | Order #{order_id} status changed to {status}. | Live |

| O3 | Order | Order cancelled | ✅ Customer | ✅ Partner(s) | Order cancelled | Order #{order_id} has been cancelled. | Live |

| O4 | Order | Order refunded (status → Refunded) | ✅ Customer | ✅ Partner(s) | Order status update | Order #{order_id} status changed to Refunded. | Planned |

| O5 | Order | Service line status changed | ✅ Customer | ✅ Partner(s) | Service update | {service_name} status changed to {status} for order #{order_id}. | Live |

| O6 | Order | Partner assigned to a service line | ❌ | ✅ Assigned partner | New service assigned | You have a new service ({service_name}) for order #{order_id}. | Live |

| O7 | Order | Partner removed from a service line | ❌ | ✅ Previous partner | Service cancelled | Service for order #{order_id} has been removed from your list. | Live |

| O8 | Order | Service date/time updated | ❌ | ✅ Assigned partner | Service time updated | Time updated for service ({service_name}) of order #{order_id}. | Live |

| O9 | Order | Single service line cancelled | ✅ Customer | ✅ Line partner | Service cancelled | Your {service_name} for order #{order_id} has been cancelled | Live |

| O11 | Order | Partner taps **Start work** | ✅ Customer | ❌ | Partner on the way | Your partner has started work on order #{order_id}. | Live |

| O12 | Order | Partner taps **Complete** (order completed) | ✅ Customer | ❌ | Order completed | Order #{order_id} has been completed by your partner. | Live |

| **Additional service charges** |

| AC1 | Additional charge | Partner adds charge on mobile | ✅ Customer | ✅ Other order parties | Additional charge added | Additional charge of {amount}{charge_label} added to order #{order_id}. | Live |

| AC2 | Additional charge | Admin / employee adds charge | ✅ Customer | ✅ Partner(s) | Additional charge added | Additional charge of {amount}{charge_label} added to order #{order_id}. | Live |

| AC3 | Additional charge | Charge(s) created with new order | ✅ Customer | ✅ Partner(s) | Additional charge added | Additional charge of {amount}{charge_label} added to order #{order_id}. | Live |

| AC4 | Additional charge | Additional service charge **updated** | ✅ Customer | ✅ Partner(s) | Additional charge updated | Additional charge {charge_label} on order #{order_id} was updated to {total_amount}. | Live |

| AC5 | Additional charge | Additional service charge **removed** | ✅ Customer | ✅ Partner(s) | Additional charge removed | Additional charge {charge_label} was removed from order #{order_id}. | Live |

| AC6 | Additional charge | Customer notified to pay updated balance *(optional copy)* | ✅ Customer | ❌ | Payment due updated | An additional charge of {total_amount}{charge_label} was added to order #{order_id}. Amount due: {new_due_amount}. | Planned |

| **Payments** |

| P1 | Payment | Customer payment recorded as completed | ✅ Customer | ✅ Partner(s) | Payment successful / Payment received | Customer: Your payment of {amount} for order #{order_id} was successful. Partner: Customer payment of {amount} received for order #{order_id}. | Live |

| P2 | Payment | Payment on mobile quote→order | ✅ Customer | ✅ Partner(s) | Payment received | Payment of {amount} received for order #{order_id}. | Live |

| P3 | Payment | Online payment failed | ✅ Customer | ❌ | Payment failed | Payment for order #{order_id} could not be completed. Please try again. | Live |

| P4 | Payment | Refund processed | ✅ Customer | ✅ Partner(s) | Refund processed | A refund of {amount} has been processed for order #{order_id}. | Live |

| **Wallet (partner only)** |

| W1 | Wallet | Wallet credited | ❌ | ✅ Partner | Wallet credit | {amount} credited to your wallet{description}. | Live |

| W2 | Wallet | Wallet debited | ❌ | ✅ Partner | Wallet debit | {amount} debited from your wallet{description}. | Live |

| W3 | Wallet | Wallet debited on refund (partner share) | ❌ | ✅ Partner | Wallet debit | {amount} debited from your wallet{description}. | Live |

| **Subscriptions (partner)** |

| S1 | Subscription | Admin assigns a plan | ❌ | ✅ Partner | Subscription assigned | Subscription plan "{plan_name}" has been assigned to you. | Live |

| S2 | Subscription | Subscription status changes | ❌ | ✅ Partner | Subscription update | Your subscription status is now {status}. | Live |

| S3 | Subscription | Partner upgrades/downgrades plan (self-service) | ❌ | ✅ Partner | Subscription update | Your subscription plan has been changed to "{plan_name}". | Live |

| S4 | Subscription | Online subscription payment completed | ❌ | ✅ Partner | Subscription update | Your subscription payment was successful. Plan: "{plan_name}". | Live |

| **Disputes** |

| D1 | Dispute | Customer raises dispute | ❌ | ❌ (employee web) | New dispute | Customer raised dispute {dispute_id} for order #{order_id}. | Live |

| D2 | Dispute | Dispute status updated | ✅ Customer | ❌ | Dispute update | Your dispute {dispute_id} for order #{order_id} is now {status}. | Live |

| **Chat (Chat Service)** |

| C1 | Chat | New message (recipient offline) | ✅ If participant | ✅ If participant | {sender_name} | {message_preview} | Live |

| **Support tickets** |

| T1 | Ticket | Ticket status changed | ✅ Ticket creator | ❌ | Ticket Update | Your ticket {ticket_id} status changed to {status}. | Live |

| **Account** |

| A1 | Account | Partner verification approved | ❌ | ✅ Partner | Account verified | Your partner account has been verified. You can now accept jobs. | Live |

| A2 | Account | Partner verification rejected | ❌ | ✅ Partner | Verification update | Your partner verification was not approved. Please check your documents. | Live |

| **Appointments** |

| AP1 | Appointment | Appointment created (manual or auto on order create) | ✅ Customer | ✅ Assigned partner | Appointment scheduled | A service appointment has been scheduled for order #{order_id}. | Live |

| AP2 | Appointment | Appointment status changed | ✅ Customer | ✅ Partner | Appointment update | Your appointment for order #{order_id} is now {status}. | Live |

| **Reviews** |

| R1 | Review | Customer submits order review/rating | ❌ | ✅ Partner | New review | You received a new review for order #{order_id}. | Live |

| **Reminders** |

| RM1 | Reminder | Upcoming service (before scheduled time) | ✅ Customer | ✅ Partner | Service reminder | Your service for order #{order_id} is scheduled soon. | Live |

| RM2 | Reminder | Quote pending action | ✅ or ✅ | Depends on quote state | Action required | Quote #{quote_id} is waiting for your response. | Live |

| RM3 | Reminder | Subscription expiring soon | ❌ | ✅ Partner | Subscription reminder | Your subscription plan expires soon. Renew to continue receiving jobs. | Live |



> **Note on AC1–AC3:** Push uses base `{amount}` (pre-tax line amount). `{charge_label}` is appended as ` (label)` when present. Partner who added the charge is excluded when `actorUserId` is passed (admin + partner mobile).



> **Note on reminders:** Fired by scheduled job (hourly recommended). User can disable via reminder notification setting in app.



---



## 4. Live event keys (backend)



All templates in `src/modules/notifications/constants/notification_events.js`:



| Event key | Title |

|-----------|-------|

| `ORDER_CREATED` | New order |

| `ORDER_STATUS_CHANGED` | Order status update |

| `ORDER_CANCELLED` | Order cancelled |

| `ORDER_SERVICE_STATUS_CHANGED` | Service update |

| `ORDER_SERVICE_ASSIGNED` | New service assigned |

| `ORDER_SERVICE_UNASSIGNED` | Service cancelled |

| `ORDER_SERVICE_TIME_UPDATED` | Service time updated |

| `ORDER_SERVICE_CANCELLED` | Service cancelled |

| `ORDER_PAYMENT_COMPLETED` | Payment successful |
| `ORDER_PAYMENT_RECEIVED` | Payment received |

| `ORDER_PAYMENT_FAILED` | Payment failed |

| `ORDER_REFUND_PROCESSED` | Refund processed |

| `ORDER_ADDITIONAL_CHARGE_ADDED` | Additional charge added |

| `ORDER_ADDITIONAL_CHARGE_UPDATED` | Additional charge updated |

| `ORDER_ADDITIONAL_CHARGE_REMOVED` | Additional charge removed |

| `PARTNER_WORK_STARTED` | Partner on the way |

| `PARTNER_WORK_COMPLETED` | Order completed |

| `ORDER_REVIEW_RECEIVED` | New review |

| `APPOINTMENT_SCHEDULED` | Appointment scheduled |

| `APPOINTMENT_STATUS_CHANGED` | Appointment update |

| `QUOTE_CREATED` | New quote |

| `QUOTE_STATUS_CHANGED` | Quote status update |

| `QUOTE_ASSIGNED` | New quote request |

| `SUBSCRIPTION_ASSIGNED` | Subscription assigned |

| `SUBSCRIPTION_STATUS_CHANGED` | Subscription update |

| `SUBSCRIPTION_PLAN_CHANGED` | Subscription update |

| `SUBSCRIPTION_PAYMENT_COMPLETED` | Subscription update |

| `WALLET_CREDIT` | Wallet credit |

| `WALLET_DEBIT` | Wallet debit |

| `DISPUTE_RAISED` | New dispute |

| `DISPUTE_STATUS_CHANGED` | Dispute update |

| `PARTNER_VERIFICATION_APPROVED` | Account verified |

| `PARTNER_VERIFICATION_REJECTED` | Verification update |

| `TICKET_STATUS_CHANGED` | Ticket Update |

| `SERVICE_REMINDER` | Service reminder |

| `QUOTE_ACTION_REMINDER` | Action required |

| `SUBSCRIPTION_EXPIRING_REMINDER` | Subscription reminder |



---



## 5. Push payload shape (mobile handling)



| Field | Description |

|-------|-------------|

| `title` / `body` | System tray copy |

| `data.event` | Event key (e.g. `ORDER_CREATED`) |

| `data.type` | Category (`order`, `quote`, `reminder`, …) or `Chat` for chat service |

| `data.entity_type` / `data.entity_id` | Deep link target |

| `metadata` | In-app record: `order_id`, `quote_id`, etc. |



In-app inbox: `GET /api/mobile/user/notifications` or `GET /api/mobile/partner/notifications`.



---



## 6. Summary counts



| | Customer app | Partner app |

|---|:------------:|:-----------:|

| **Live** | 32 instances | 36 instances |

| **Planned** | 2 instances (O4, AC6) | 1 instance (O4) |

| **Unified event keys** | 36 total | 36 total |



---



## 7. Document history



| Date | Change |

|------|--------|

| 2026-07-07 | Initial client spec |

| 2026-07-08 | Phases 1–4 marked live; 36 event keys; reminders documented |


