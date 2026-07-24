# WhatsApp Webhook Setup (Meta)

This backend exposes a Meta WhatsApp webhook at:

```text
GET  /api/whatsapp/webhook   — verification challenge (one-time Meta setup)
POST /api/whatsapp/webhook   — delivery status + template status events
```

OTP login still works without webhooks. Webhooks are for **delivery tracking**, **template approval alerts**, and **debugging**.

---

## 1. Lambda environment variables

Add these in addition to the existing WhatsApp OTP vars:

| Variable | Required | Description |
|----------|----------|-------------|
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Yes | Any long random string you choose. Must match what you enter in Meta Console. |
| `WHATSAPP_APP_SECRET` | Yes (production) | App Secret from Meta Developer Console → App settings → Basic |
| `WHATSAPP_WEBHOOK_SKIP_SIGNATURE_VERIFY` | No | `true` only for local/ngrok testing. Must be `false` or unset in production. |

Example:

```env
WHATSAPP_WEBHOOK_VERIFY_TOKEN=helppr_whatsapp_verify_a8f3c91d2e
WHATSAPP_APP_SECRET=your_meta_app_secret_here
WHATSAPP_WEBHOOK_SKIP_SIGNATURE_VERIFY=false
```

Generate a verify token:

```bash
openssl rand -hex 24
```

---

## 2. Public callback URL

Meta must reach your API over **HTTPS**.

Use your API Gateway / load balancer base URL:

```text
https://<your-api-domain>/api/whatsapp/webhook
```

Examples:

- `https://api.helppr.com/api/whatsapp/webhook`
- `https://abc123.execute-api.ap-south-1.amazonaws.com/api/whatsapp/webhook`

Deploy the backend code **before** registering the webhook in Meta.

---

## 3. Register webhook in Meta Developer Console

### Step A — Open WhatsApp configuration

1. Go to [developers.facebook.com](https://developers.facebook.com/)
2. Open your **App**
3. Left menu → **WhatsApp** → **Configuration**

### Step B — Edit webhook

1. Find **Webhook** section → click **Edit**
2. **Callback URL:** `https://<your-api-domain>/api/whatsapp/webhook`
3. **Verify token:** same value as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in Lambda
4. Click **Verify and save**

Meta sends:

```http
GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=RANDOM_STRING
```

Your server must respond with the **challenge string as plain text** (not JSON). This is already implemented.

If verification fails, check:

- Lambda has `WHATSAPP_WEBHOOK_VERIFY_TOKEN` set correctly
- URL is publicly reachable over HTTPS
- API Gateway route forwards `GET /api/whatsapp/webhook` to Lambda
- No auth middleware blocking the route

### Step C — Subscribe to webhook fields

After verification, click **Manage** (or **Subscribe**) and enable:

| Field | Purpose |
|-------|---------|
| **messages** | OTP delivery status (`sent`, `delivered`, `read`, `failed`) and any user replies |
| **message_template_status_update** | Template approved / rejected / paused notifications |

You do **not** need other fields for OTP login.

### Step D — Subscribe your WABA (if prompted)

In some setups you must also subscribe the WhatsApp Business Account to your app under **WhatsApp → API Setup**.

---

## 4. App Secret for POST signature verification

Every `POST` webhook includes header:

```text
X-Hub-Signature-256: sha256=<hmac>
```

The backend verifies this using `WHATSAPP_APP_SECRET`.

Find App Secret:

1. Meta Developer Console → your App
2. **App settings** → **Basic**
3. Copy **App secret** → set as `WHATSAPP_APP_SECRET` in Lambda

If signature verification fails, Meta events are rejected with `403`.

---

## 5. What the backend does with events

### Message delivery status (`messages` → `statuses`)

When an OTP is sent, we store `provider_message_id` on the `otp` document.

Webhook updates:

- `otp.delivery_status` — e.g. `sent`, `delivered`, `read`, `failed`
- `otp.delivery_status_at`
- `otp.delivery_error` — if Meta reports failure

A full audit row is also stored in `whatsapp_webhook_log`.

### Template status (`message_template_status_update`)

Logged when Meta approves/rejects your authentication template.

### Incoming user messages (`messages` → `messages`)

If a user replies on WhatsApp, it is logged for support/debugging. OTP login does not depend on this.

---

## 6. Testing

### A. Verify endpoint (manual)

```bash
curl "https://<your-api-domain>/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=12345"
```

Expected response body:

```text
12345
```

### B. End-to-end OTP test

1. Call `POST /api/mobile/user/login` with a phone number
2. Check MongoDB `otp` collection — `provider_message_id` should be set
3. After WhatsApp delivers, webhook should update `delivery_status` to `delivered`
4. Check `whatsapp_webhook_log` collection for raw event payload

### C. Local development with ngrok

```bash
ngrok http 5001
```

Set callback URL to:

```text
https://<ngrok-id>.ngrok.io/api/whatsapp/webhook
```

For local testing only:

```env
WHATSAPP_WEBHOOK_SKIP_SIGNATURE_VERIFY=true
NODE_ENV=development
```

Use real `WHATSAPP_APP_SECRET` in staging/production.

---

## 7. Troubleshooting

| Issue | Fix |
|-------|-----|
| Meta says "could not verify webhook" | Check verify token, HTTPS URL, Lambda deployed, GET route works |
| `403` on POST events | Set correct `WHATSAPP_APP_SECRET`; disable skip-signature in prod |
| No delivery status updates | Subscribe to **messages** field; confirm `provider_message_id` is saved on send |
| Webhook works but OTP not received | Template/billing issue on Meta side, not webhook |
| API Gateway 404 | Add route for `/api/whatsapp/webhook` (GET + POST) |

---

## 8. Security notes

- Keep `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` secret
- Never set `WHATSAPP_WEBHOOK_SKIP_SIGNATURE_VERIFY=true` in production
- Webhook route is public by design (Meta calls it); security is via verify token + HMAC signature

---

## Related docs

- [Meta — Webhooks for WhatsApp](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks)
- [Meta — Authentication OTP templates](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/auth-otp-template-messages/)
- Project README — WhatsApp OTP env vars
