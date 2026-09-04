# Here is a structured mind map of Apple payments in this project. It is App Store IAP for partner plans, not Apple Pay on orders.

## Root

```text
                    APPLE IN THIS BACKEND
                             │
     ┌───────────────────────┼───────────────────────┐
     │                       │                       │
SIGN IN WITH APPLE     APPLE IAP (MONEY)      NOT IMPLEMENTED
login only             partner subscriptions  Apple Pay on orders
user.apple_id          StoreKit + verify      partner bank payout
                       restore + webhook
```

Only the middle branch is a payment.

---

## 1. What Apple IAP is for

```text
APPLE IAP
└── Partner paid membership (iOS App Store)
      bundle:  com.partnerapp.helppr
      group:   Premium Membership (22339091)
            │
            ├── basic      → no product (free)
            ├── silver     → com.partnerapp.helppr.silver.monthly
            ├── gold       → com.partnerapp.helppr.gold.monthly
            └── platinum   → com.partnerapp.helppr.platinum.monthly
```

Android / web partners still pay the same plans with Razorpay. iOS digital goods must go through Apple.

---

## 2. Two billing worlds (do not mix)

```text
PARTNER PLAN CHANGE
├── payment_method: razorpay / wallet / cash / online
│     → Razorpay Payment Link
│     → gateway_payment
│
└── payment_method: apple
      → NO payment_url
      → NO wallet / cash / online amounts  (400 if mixed)
      → App Store charges the partner
      → backend only VERIFIES the receipt
```

---

## 3. End-to-end strip

```text
PARTNER APP                    THIS API                         APPLE
     │                            │                               │
     │ 1. POST /subscription/change                               │
     │    payment_method: apple    │                               │
     │    target_plan_id           │                               │
     │ ───────────────────────────►│  pending change row          │
     │◄─────────────────────────── │  apple_product_id            │
     │    payment_url: null        │                               │
     │                             │                               │
     │ 2. StoreKit purchase ──────────────────────────────────────►│
     │                             │                    partner pays
     │ 3. POST /subscription/apple/verify                          │
     │    signed_transaction_info  │                               │
     │ ───────────────────────────►│  verify JWS ─────────────────►│
     │                             │◄──── decoded product/expiry ──│
     │                             │  apply plan                   │
     │◄─────────────────────────── │  completed                    │
     │                             │                               │
     │                             │◄── POST /api/apple/iap/       │
     │                             │    notifications              │
     │                             │    DID_RENEW / EXPIRED / REFUND
```

---

## 4. API mind map

```text
/api/mobile/partner   (Bearer partner JWT, verified type 2)
│
├── POST /subscription/change
│     payment_method: "apple"
│     target_plan_id
│     → initiateAppleChange
│     →  pending partner_subscription_change
│
├── POST /subscription/apple/verify
│     signed_transaction_info  (or transaction_id)
│     optional change_id, signed_renewal_info
│     → verifyApplePurchase
│
├── POST /subscription/apple/restore
│     same receipt fields
│     → restoreApplePurchase  (new phone / reinstall)
│
└── GET  /subscription/change/:changeId/payment-status
      Apple: no Razorpay poll; payment_url stays null
```

```text
APPLE → SERVER (no JWT, raw JSON)
└── POST /api/apple/iap/notifications
      signedPayload
      → handleAppleNotification
```

Partner must be verified (verification_status = 2) and not blocked.

---

## 5. Initiate (before money)

```text
POST .../subscription/change  { payment_method: apple }
        │
        ├─ reject if wallet/cash/online > 0
        ├─ must have active subscription
        ├─ target plan ≠ current plan
        ├─ target must map to an IAP product (not Basic)
        ├─ expire stale Apple pending rows (> 24h)
        └─ insert partner_subscription_change
              status: pending
              payment_status: pending
              payment_method: apple
              apple_product_id: com.partnerapp.helppr.gold.monthly
              from_plan_id / to_plan_id
              amount_to_pay: 0 on this path (Apple collects)
```

App then shows StoreKit for that apple_product_id.

---

## 6. Verify (the receipt is the receipt)

```text
POST .../subscription/apple/verify
        │
        ├─ decode JWS  OR  fetch transaction from Apple API
        ├─ productId must match pending apple_product_id
        ├─ entitlement still active (not revoked / not expired)
        ├─ originalTransactionId not already owned by another partner
        └─ applyAppleEntitlement
              ├── apple_iap_transaction   (idempotent)
              ├── partner_subscription
              │     billing_source: apple_iap
              │     apple_original_transaction_id
              │     apple_product_id
              │     expires_at
              │     apple_auto_renew_status
              └── change.status → completed
```

Same idea as Razorpay: pending first, Apple confirms, then completed.

---

## 7. Webhook (Apple Server Notifications V2)

```text
POST /api/apple/iap/notifications
        │
        ├─ parse signedPayload
        ├─ skip if notification_uuid already stored
        ├─ find partner_subscription by original_transaction_id
        │     if none → ignore (partner_not_linked)
        │
        ├── GRANT
        │     SUBSCRIBED | DID_RENEW | OFFER_REDEEMED | RENEWAL_EXTENDED
        │     → keep/extend paid plan
        │
        └── REVOKE
              EXPIRED | GRACE_PERIOD_EXPIRED | REFUND | REVOKE
              → drop entitlement (typically back to Basic)
```

Renewals can complete without the app calling verify again.

---

## 8. Restore

```text
POST .../subscription/apple/restore
        │
        └─ same verify of signed transaction
              relink this partner to original_transaction_id
              apply current Apple entitlement
```

Used after reinstall or device change.

---

## 9. Collections

```text
subscription_plan
└── plan_name  →  apple_product_id  (API adds this; not a DB column)
```

```text
partner_subscription_change
├── payment_method: apple
├── apple_product_id
├── apple_transaction_id
├── apple_original_transaction_id
├── apple_environment          sandbox | Production
├── status  pending → completed | expired | cancelled
└── payment_url: never set
```

```text
partner_subscription
├── billing_source: apple_iap | razorpay | admin
├── apple_original_transaction_id   (unique)
├── apple_product_id
├── apple_auto_renew_status
└── expires_at
```

```text
apple_iap_transaction
├── partner_id, change_id
├── transaction_id            unique
├── original_transaction_id
├── product_id, bundle_id, environment
├── expires_at, purchase_date
├── notification_uuid         unique (webhook dedupe)
└── source: verify | restore | notification
```

---

## 10. Status mind map

```text
change.status
├── pending     waiting for StoreKit + verify (max 24h then expired)
├── completed   entitlement applied
├── cancelled
└── expired     never verified in time
```

```text
subscription.billing_source
├── apple_iap   money via App Store
├── razorpay    money via Payment Link
└── admin       assigned in dashboard
```

```text
transaction.source
├── verify         app just purchased
├── restore        app restored
└── notification   Apple server push
```

---

## 11. Code map

```text
constants/apple_iap.js
      product IDs, grant/revoke notification sets
src/modules/apple_iap/
      SignedDataVerifier + App Store Server API
      (@apple/app-store-server-library)
services/mobile/partner/apple_iap_subscription_service.js
      initiate / verify / restore / handleAppleNotification
services/mobile/partner/subscription_change_service.js
      if payment_method === apple → hand off to IAP service
routes/mobile/partner/subscription_routes.js
server.js  POST /api/apple/iap/notifications
```

Env: APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID, APPLE_IAP_PRIVATE_KEY, APPLE_IAP_BUNDLE_ID, APPLE_IAP_APP_APPLE_ID, APPLE_IAP_ENVIRONMENT.

---

## 12. One-page picture

```text
                 ┌─────────────────────────────────┐
                 │     Partner iOS (StoreKit)       │
                 └────────────────┬────────────────┘
                                  │ pays Apple
                                  ▼
                 ┌─────────────────────────────────┐
                 │           APPLE                  │
                 │  charges card • signs JWS        │
                 │  renews / refunds / expires      │
                 └───────┬───────────────┬─────────┘
                         │ verify        │ S2S notify
                         ▼               ▼
                 ┌─────────────────────────────────┐
                 │         THIS BACKEND             │
                 │  pending change → completed      │
                 │  partner_subscription apple_iap  │
                 │  apple_iap_transaction audit     │
                 └─────────────────────────────────┘
```

Orders / quote deposits / partner payout  →  NOT this path  
                                              (Razorpay / cash / wallet)

One line: Apple payments here = iOS partner buys Silver/Gold/Platinum in the App Store; this API starts a pending change, verifies (or gets Apple’s webhook), then sets billing_source: apple_iap. It is not Apple Pay for customer orders.
