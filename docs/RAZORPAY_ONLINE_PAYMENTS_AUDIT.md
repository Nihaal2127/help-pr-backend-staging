# Razorpay online payments — implementation audit

**Date:** June 2026  
**Module:** `src/modules/payments/`  
**Webhook:** `POST /api/razorpay/razorpayWebhook`  
**Env:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_BASE_URL`

---

## Summary

| Flow | Admin API | Mobile API | Razorpay | `gateway_payment` audit |
|------|-----------|------------|----------|---------------------------|
| Order create (full checkout) | ✅ `POST /api/order/create` (`payment_mode_id: "2"`) | — | ✅ Payment link | ✅ On webhook |
| Quote → order (deposit) | ❌ No admin convert route | ✅ `POST /api/mobile/user/quotes/:id/convert-to-order` | ✅ | ✅ |
| Customer order payments | ✅ `POST /api/order-payments/create` + `GET /payment-status/:id` | ✅ `POST .../orders/:id/payments` + `GET .../payment-status` | ✅ | ✅ |
| Additional service charges | ⚠️ Metadata only | ⚠️ No pay endpoint | ❌ | — |
| Partner subscription upgrade | — | ✅ `POST .../subscription/change` (`online_amount`) | ✅ | ✅ |
| Partner payouts (wallet → bank) | ❌ Manual (`/api/partner_payout`) | ❌ | ❌ | — |
| **Order refunds (customer)** | ✅ `POST /api/refund/create` + `refund_via_razorpay: true` | ❌ **403** | ✅ Refund API | ✅ `refunded_amount` on capture |

**Additional charges:** `payment_method` on a charge is a **label**; it does not create a Razorpay link. After a charge is added, the customer pays the increased `customer_due_amount` via **order payments** (mobile online flow).

**Partner payouts:** Outbound bank transfers use admin wallet debit (`upi`, `bank_transfer`, `cash`, `cheque`). This is **not** Razorpay Payment Links; outbound would need RazorpayX Payouts (not implemented).

---

## Tables updated on Razorpay completion

### Customer order payment (`completeOrderPaymentFromWebhook`)

| Table / model | What updates |
|---------------|--------------|
| `order_payment` | `status` → `completed`, `paid_at`, `transaction_reference` (pay id) |
| `gateway_payment` | Audit row (`purpose: order`) |
| `order` | `payment_status`, `user_payment_status`, `customer_*` amounts, `is_paid`, `partner_*` rollups |
| `order_service` | `is_paid` on line items when order fully paid |
| `partner_wallet_ledger` | Re-synced credits for completed **partner** `order_payment` rows (capped by `customer_net_paid`) |

All paths call `finalizeCompletedOrderPaymentSideEffects` (order rollups + wallet ledger + optional notification).

### Partner subscription online (`completeOnlineChangeFromWebhook`)

| Table / model | What updates |
|---------------|--------------|
| `partner_subscription_change` | `status` → `completed`, `payment_status`, `applied_at`, `transaction_reference` |
| `partner_subscription` | Plan upgrade applied |
| `partner_wallet_ledger` | Wallet **debit** at pending create (if `wallet_amount`); downgrade **credit** on apply when applicable |
| `gateway_payment` | Audit row (`purpose: subscription_change`) |

---

## Implemented flows (detail)

### 1. Shared infrastructure

| File | Role |
|------|------|
| `razorpay.client.js` | Create/fetch payment links, webhook signature (raw body + API Gateway) |
| `razorpay.service.js` | `createOrderPaymentLink`, `createSubscriptionChangePaymentLink` |
| `orderOnlinePayment.service.js` | Pending `order_payment`, resume, sync, webhook completion |
| `webhook.dispatcher.js` | Routes `payment_link.paid` → order then subscription |
| `gatewayPayment.service.js` | Idempotent `gateway_payment` rows |
| `models/gateway_payment.js` | `purpose`: `order` \| `subscription_change` |

**Pattern:** pending DB row → `transaction_reference = plink_xxx` → **202** + `payment_url` → webhook or poll completes → `gateway_payment` + mark `completed`.

### 2. Admin — order create online

- **Route:** `POST /api/order/create`
- **Trigger:** `payment_mode_id === "2"` + `name`, `email`, `contact` on body
- **Behavior:** Order saved first, then `initiateOnlineOrderPayment` for `total_price`
- **Response:** `record.payment_url`, `record.order_id`, `record.payment_id`

### 2b. Admin — mid-order customer payment online

- **Initiate:** `POST /api/order-payments/create` — `payer_type: customer`, `payment_method: online`, `amount` > 0
- **Optional:** `name`, `email`, `contact` on body (else loaded from order customer profile)
- **Poll:** `GET /api/order-payments/payment-status/:paymentId`
- **Response:** **202** + `record.payment_url` (same resume/webhook pattern as mobile)

### 3. Mobile — customer order payment

- **Initiate:** `POST /api/mobile/user/orders/:orderId/payments` (`payment_method: online`, `amount` > 0)
- **Poll:** `GET /api/mobile/user/orders/:orderId/payments/:paymentId/payment-status`
- **Resume:** Same POST with same amount → same URL (`resumed: true`)
- **Requires:** Customer profile email or phone

### 4. Mobile — quote deposit online

- **Route:** `POST /api/mobile/user/quotes/:id/convert-to-order`
- **Behavior:** Creates order, then Razorpay link for deposit `amount`
- **Response:** **202** + `data.payment.payment_url`

### 5. Mobile — partner subscription online

- **Route:** `POST /api/mobile/partner/subscription/change` with `online_amount`
- **Poll:** `GET /api/mobile/partner/subscription/change/:changeId/payment-status`
- **Doc:** `docs/SUBSCRIPTION_CHANGE_FRONTEND.md`

---

## Not implemented / out of scope

| Item | Notes |
|------|--------|
| Admin `POST /api/order-payments/create` with `online` | ✅ Wired (June 2026) |
| Admin quote convert | No `/api/quote/.../convert` route |
| Dedicated “pay additional charge” API | Use order payments for updated due |
| `payment_link.expired` / `cancelled` webhooks | Pending rows cleared on resume/poll only |
| Partner payout via Razorpay | Use `/api/partner_payout` (manual) |
| Admin list `gateway_payment` | No REST API yet |

---

## Postman

| Collection | Razorpay coverage |
|------------|-------------------|
| `Help-PR-Mobile-APIs.postman_collection.json` | Subscription, order payment online, payment-status, quote convert online |
| `Help-PR-All-APIs.postman_collection.json` | Admin order create online, folder **31 — Razorpay**, mobile folder via `build-mobile-folder.mjs` |

**Refresh All-APIs mobile section:** `node postman/build-mobile-folder.mjs`

---

## Test credentials (Razorpay test mode)

- Card: `4111111111111111`, any future expiry, CVV `123`
- UPI: `success@razorpay`

---

## Related docs

- `docs/ORDER_MODULE_FRONTEND.md` — orders, charges, payments, mobile Razorpay section
- `docs/SUBSCRIPTION_CHANGE_FRONTEND.md` — partner subscription online
- `docs/PARTNER_PAYOUT_FRONTEND.md` — wallet payouts (not Razorpay)
