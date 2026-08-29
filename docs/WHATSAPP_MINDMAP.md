# HelpPR WhatsApp — complete flow mind map

WhatsApp here is **not chat**. It is only **Meta Cloud API for login OTPs**, plus a webhook that tracks whether that OTP actually arrived.

HelpPR in-app chat still runs on the Chat Service (Socket.IO). WhatsApp never opens a conversation with the customer.

---

## What it does

```text
WHATSAPP IN THIS PROJECT
├── SEND OTP          Meta template message (authentication)
├── TRACK DELIVERY    webhook: sent / delivered / read / failed
└── LOG REPLIES       user WhatsApp replies are stored for debug only
                      (login does not use them)
```

Used when:

- Customer: `POST /api/mobile/user/login` then `POST /api/mobile/user/verify-otp`
- Partner: partner phone OTP login (same send helper)
- Older web/OTP path: `POST /api/otp/send_otp`

---

## Two directions

```text
YOU (this backend)                    META
 │                                      │
 │  1. POST Graph API /messages ───────►│  send OTP template
 │     Bearer WHATSAPP_ACCESS_TOKEN     │
 │  2. message id (wamid.xxx)  ◄────────│
 │                                      │
 │                                      │  customer gets WhatsApp OTP
 │                                      │
 │  3. POST /api/whatsapp/webhook ◄─────│  statuses: sent/delivered/read/failed
 │     X-Hub-Signature-256              │
```

Send is required for login. Webhook is optional: login still works if Meta never calls back.

---

## Send OTP (the real integration)

Shared function: `issueAndSendPhoneOtp` in `services/mobile/shared/phone_otp_delivery_service.js`.

```text
POST /api/mobile/user/login  { phone_number }
        │
        ├─ find or create customer
        ▼
issueAndSendPhoneOtp
        │
        ├─ 1. Generate  OTP, hash it (plain OTP never stored)
        ├─ 2. Delete old OTP rows for that phone
        ├─ 3. Save otp document (hash + expiry, default 10 min)
        ├─ 4. helper/whatsapp.js → sendVerificationOtp
        │        POST https://graph.facebook.com/{v22.0}/{PHONE_NUMBER_ID}/messages
        │        type: template
        │        template name: WHATSAPP_OTP_TEMPLATE_NAME
        │        body param = the OTP
        │        optional copy-code button if WHATSAPP_OTP_INCLUDE_COPY_BUTTON
        │
        ├─ 5. If Meta fails → DELETE the otp row, return 503
        └─ 6. If Meta ok → save provider_message_id on otp
               return "OTP sent to WhatsApp successfully."
```

Phone is sent to Meta as **digits only** (e.g. `919876543210`), via `toWhatsAppRecipient`.

Dev without Meta:

```text
WHATSAPP_ENABLED=false
WHATSAPP_OTP_DEV_FALLBACK=true   (and NODE_ENV ≠ production)
→ OTP printed in server logs, messageId = "dev-fallback"
```

If neither real send nor fallback is on: `"OTP delivery is not configured."`

Verify is **not** WhatsApp. The app posts the code; the backend compares hashes (`verifyPhoneOtpSubmission`), max **5** attempts, then issues a JWT. Meta is not called again.

---

## Webhook (delivery tracking)

Mounted in `server.js` **before** `express.json`, with raw body — same pattern as Razorpay — so HMAC can be checked.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/whatsapp/webhook` | Meta “Verify and save” (one-time) |
| `POST` | `/api/whatsapp/webhook` | Live events |

### GET — subscribe

Meta: `?hub.mode=subscribe&hub.verify_token=...&hub.challenge=12345`

If token equals `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, the server replies with **plain text** `12345`, not JSON.

### POST — events

1. Check `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET` (HMAC-SHA256 of raw body).
2. Skip check only if `WHATSAPP_WEBHOOK_SKIP_SIGNATURE_VERIFY=true` **and** not production.
3. Dispatch in `webhook.dispatcher.js`:

```text
POST body.entry[].changes[]
        │
        ├── field: messages
        │     ├── statuses[]  → OTP delivery
        │     │     match otp.provider_message_id
        │     │     set delivery_status, delivery_status_at, delivery_error
        │     │     also write whatsapp_webhook_log
        │     └── messages[]  → user replied on WhatsApp
        │           log only (login ignores this)
        │
        └── field: message_template_status_update
              template approved / rejected / paused
              log only
```

Subscribe in Meta to **`messages`** and **`message_template_status_update`**.

---

## Where data lives

```text
otp
├── phone_number
├── otp                    hashed
├── expiresAt
├── attempts
├── provider_message_id    Meta wamid  ← webhook join key
├── delivery_status        sent | delivered | read | failed
├── delivery_status_at
└── delivery_error

whatsapp_webhook_log       append-only audit
├── event_type             message_status | incoming_message | template_status
├── provider_message_id
├── phone_number
├── status / error / payload
```

---

## Code map

| Piece | File |
|--------|------|
| Graph API send | `helper/whatsapp.js` |
| Generate / hash / verify OTP | `helper/phone_otp.js` |
| Persist + send + rollback | `services/mobile/shared/phone_otp_delivery_service.js` |
| Customer login send | `services/mobile/user/user_service.js` → `sendOtp` |
| Partner login send | `services/mobile/partner/partner_service.js` → `sendPartnerOtp` |
| Legacy `/api/otp/send_otp` | `controllers/otp_controller.js` |
| GET/POST webhook | `controllers/whatsapp_webhook_controller.js` |
| HMAC | `src/modules/whatsapp/webhook.signature.js` |
| Event handling | `src/modules/whatsapp/webhook.dispatcher.js` |
| Smoke test | `npm run verify:whatsapp-otp -- 9876543210` |

---

## Env vars

**Send OTP**

| Variable | Role |
|----------|------|
| `WHATSAPP_ENABLED` | `true` to call Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | Cloud API phone number id |
| `WHATSAPP_ACCESS_TOKEN` | permanent system-user token |
| `WHATSAPP_OTP_TEMPLATE_NAME` | approved AUTHENTICATION template |
| `WHATSAPP_OTP_TEMPLATE_LANGUAGE` | default `en` |
| `WHATSAPP_OTP_EXPIRY_MINUTES` | default `10` (match template footer) |
| `WHATSAPP_API_VERSION` | default `v22.0` |
| `WHATSAPP_OTP_INCLUDE_COPY_BUTTON` | extra button component if template has copy-code |
| `WHATSAPP_OTP_DEV_FALLBACK` | log OTP locally, non-production only |

**Webhook**

| Variable | Role |
|----------|------|
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | must match Meta Console |
| `WHATSAPP_APP_SECRET` | HMAC of POST body |
| `WHATSAPP_WEBHOOK_SKIP_SIGNATURE_VERIFY` | local/ngrok only |

Callback URL Meta must hit: `https://<api-domain>/api/whatsapp/webhook`

---

## End-to-end story

```text
Customer taps Login, enters 9876543210
        │
POST /api/mobile/user/login
        │
otp row saved (hash), Meta template sent
        │  wamid stored
        ▼
WhatsApp on phone: "Your code is 482913"
        │
Meta webhook: sent → delivered → read
        │  otp.delivery_status updates
        ▼
Customer types 482913
POST /api/mobile/user/verify-otp
        │  hash match, attempts < 5
        ▼
JWT issued. WhatsApp is done.
```

If Meta is down at send time, the otp row is deleted and the app gets **503**. If the webhook never fires, the user can still verify — delivery fields just stay empty.

---

## What it is not

- Not HelpPR chat (that is VPS Socket.IO).
- Not order/support notifications to WhatsApp.
- Not two-way bots. Incoming WhatsApp messages are only logged.

In one line: **this backend sends a Meta authentication template for phone login, stores the hashed OTP itself, and optionally records Meta delivery events on webhook.**
